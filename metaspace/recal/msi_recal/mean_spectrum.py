import logging

import numpy as np
import pandas as pd
from joblib import Parallel, delayed
from msiwarp.util.warp import to_mz, to_height, to_mx_peaks, generate_mean_spectrum

from msi_recal.db_peak_match import join_by_mz
from msi_recal.math import mass_accuracy_bounds, weighted_stddev, peak_width
from msi_recal.params import RecalParams, InstrumentType

logger = logging.getLogger(__name__)


def spectra_to_mx_spectra(spectra, instrument, sigma_1):
    return [to_mx_peaks(mzs, ints, sigma_1, sp, instrument) for sp, mzs, ints in spectra]


def mx_spectra_to_spectra(spectra):
    return [(to_mz(spectrum), to_height(spectrum)) for spectrum in spectra]


def _get_mean_spectrum(
    mx_spectra: np.array,
    instrument: InstrumentType,
    sigma_1: float,
):
    tics = np.array([np.sum(to_height(s)) for s in mx_spectra])
    # min_mz = np.floor(np.min([s[0].mz for s in mx_spectra if len(s)]))
    # max_mz = np.ceil(np.max([s[-1].mz for s in mx_spectra if len(s)]))
    min_mz = np.floor(np.min([np.min(to_mz(s)) for s in mx_spectra if len(s)]))
    max_mz = np.ceil(np.max([np.max(to_mz(s)) for s in mx_spectra if len(s)]))

    # MSIWarp's generate_mean_spectrum needs a temporary array to store a fuzzy histogram of peaks
    # with a distribution function that ensures the peak width is a constant number of bins
    # throughout the m/z range. The formula for this is different for each instrument.
    # n_points specifies how big the temporary array should be. If it's set too low, the function
    # silently fails. If it's set too high, it takes longer to run and there are console warnings.
    # Predict the required number of n_points so that neither of these conditions are hit.
    # A buffer of 10% + 1000 is added to compensate for numerical error
    exp = {'tof': 1, 'orbitrap': 1.5, 'ft-icr': 2}[instrument]
    density_samples = np.linspace(min_mz, max_mz, 100) ** exp * 0.25 * sigma_1
    n_points = int(
        (max_mz - min_mz) / np.average(density_samples, weights=1 / density_samples) * 1.1 + 1000
    )

    return generate_mean_spectrum(
        mx_spectra,
        n_points,
        sigma_1,
        min_mz,
        max_mz,
        tics,
        instrument,
        stride=1,
    )


def _get_mean_spectrum_mx(task_spectra, instrument: InstrumentType, sigma_1: float):
    mx_spectra = spectra_to_mx_spectra(task_spectra, instrument, sigma_1)
    return _get_mean_spectrum(mx_spectra, instrument, sigma_1)


def get_mean_mx_spectrum_parallel(spectra, instrument: InstrumentType, sigma_1: float):
    """
    Merges many spectra into a single mean spectrum using MSIWarp's generate_mean_spectrum.
    As generate_mean_spectrum's processing time scales with the total number of peaks,
    this function first breaks the spectra into small batches to maximize parallelism,
    then gets the mean spectrum of the batches.
    """
    spectra = [(sp, mzs, ints) for sp, mzs, ints in spectra if len(mzs)]
    if len(spectra) == 0:
        return np.array([]), np.array([])

    # Shuffle spectra to prevent systematic biases between the batches that would
    # break the assumption that sigmas decrease predictably after merging
    np.random.shuffle(spectra)

    if len(spectra) <= 100:
        # Input was too small to warrant parallelizing, so run it in a single pass
        mean_spectrum = _get_mean_spectrum_mx(spectra, instrument, sigma_1)
    else:
        # Balance the batches
        batch_size = int(np.ceil(np.sqrt(len(spectra))))
        with Parallel() as parallel:
            merged_mx_spectra = parallel(
                delayed(_get_mean_spectrum_mx)(spectra[i : i + batch_size], instrument, sigma_1)
                for i in range(0, len(spectra), batch_size)
            )
        # Reduce the sigma when aggregating. The error of the mean of multiple independent
        # samples from a distribution decreases proportionately to the sqrt of the number
        # of samples.
        merged_sigma_1 = sigma_1 / np.sqrt(batch_size)
        mean_spectrum = _get_mean_spectrum(
            merged_mx_spectra,
            instrument,
            merged_sigma_1,
        )

    # Ensure spectrum is sorted
    return mean_spectrum[np.argsort(to_mz(mean_spectrum))]


def make_spectra_df(spectra):
    return pd.DataFrame(
        {
            'sp_i': np.concatenate(
                [np.full(len(mzs), sp_i, dtype=np.uint32) for sp_i, mzs, ints in spectra]
            ),
            'mz': np.concatenate([mzs for sp_i, mzs, ints in spectra]),
            'ints': np.concatenate([ints for sp_i, mzs, ints in spectra]),
        }
    ).sort_values('mz')


def get_mean_spectrum_df_parallel(
    peaks_df: pd.DataFrame, instrument: InstrumentType, sigma_1: float
):
    spectra = [(sp, df.mz, df.ints) for sp, df in peaks_df.groupby('sp')]
    mx_spectrum = get_mean_mx_spectrum_parallel(spectra, instrument, sigma_1)
    return make_spectra_df([(1000000, to_mz(mx_spectrum), to_height(mx_spectrum))])


def annotate_mean_spectrum(spectra_df, ref_mzs, instrument, sigma_1, min_coverage=0):
    """Creates a detailed mean spectrum that includes standard deviation stats for mz and intensity,
    and "coverage" - the fraction of spectra that the peak was found in.
    """
    if not spectra_df.mz.is_monotonic_increasing:
        spectra_df = spectra_df.sort_values('mz')

    n_spectra = spectra_df.sp.nunique()

    min_mzs, max_mzs = mass_accuracy_bounds(ref_mzs, instrument, sigma_1)
    lo_idxs = np.searchsorted(spectra_df.mz, min_mzs, 'left')
    hi_idxs = np.searchsorted(spectra_df.mz, max_mzs, 'right')

    results = []
    for ref_mz, lo_idx, hi_idx in zip(ref_mzs, lo_idxs, hi_idxs):
        if hi_idx - lo_idx >= n_spectra * min_coverage:
            sps = spectra_df.sp.iloc[lo_idx:hi_idx]
            n_hits = sps.nunique()
            if lo_idx != hi_idx and n_hits >= n_spectra * min_coverage:
                mzs = spectra_df.mz.iloc[lo_idx:hi_idx]
                ints = spectra_df.ints.iloc[lo_idx:hi_idx]
                mz_mean, mz_stddev = weighted_stddev(mzs, ints)
                ints_mean = sum(ints) / n_spectra
                results.append(
                    {
                        'mz': ref_mz,
                        'mz_mean': mz_mean,  # Mainly for debugging - should not differ signifcantly from ref_mz
                        'mz_stddev': mz_stddev,
                        'ints': ints_mean,
                        'ints_stddev': np.sqrt(np.average((ints - ints_mean) ** 2)),
                        'coverage': n_hits / n_spectra,
                    }
                )

    # print(f'Hybrid spectrum {len(ref_mzs)} -> {len(results)} of {len(spectra_df)}')
    return pd.DataFrame(results)


def get_alignment_peaks(annotated_mean_spectrum, n_peaks):
    # Split spectrum into 4 segments so that the full mass range is well covered
    n_segments = 4
    min_mz = annotated_mean_spectrum.mz.iloc[0]
    max_mz = annotated_mean_spectrum.mz.iloc[:-1]
    # Add 0.0001 to upper bound so the last peak is included
    segment_mzs = np.linspace(min_mz, max_mz + 0.0001, n_segments + 1)
    segment_idxs = np.searchsorted(annotated_mean_spectrum.mz, segment_mzs)

    peak_idxs = []
    for i, (segment_lo, segment_hi) in enumerate(zip(segment_idxs[:-1], segment_idxs[1:])):
        segment = annotated_mean_spectrum.iloc[segment_lo:segment_hi]
        # Choose highly intense, well-covered peaks
        scores = segment.ints * segment.coverage
        peak_idxs.extend(segment_lo + np.argsort(scores)[-n_peaks // n_segments :])

    return annotated_mean_spectrum[np.sort(peak_idxs)]


def get_representative_spectrum(
    spectra_df: pd.DataFrame,
    mean_spectrum: pd.DataFrame,
    instrument: InstrumentType,
    sigma_1: float,
    remove_bg=False,
):
    """Finds the single spectrum that is most similar to the mean spectrum"""
    mean_spectrum = mean_spectrum.rename(columns={'mz': 'mean_mz', 'ints': 'mean_ints'})

    if remove_bg:
        # Exclude peaks that only exist in a fraction of spectra
        background_threshold = np.median(mean_spectrum.coverage)
        mean_spectrum = mean_spectrum[mean_spectrum.coverage > background_threshold]

    # Find the spectrum that's most similar to the background spectrum
    spectrum_scores = {}
    processed_spectra = {}
    for sp, grp in spectra_df.groupby('sp'):
        joined = join_by_mz(mean_spectrum, 'mean_mz', grp, 'mz', instrument, sigma_1, how='left')
        mz_tol = peak_width(joined.mz, instrument, sigma_1) / 2
        joined['mz_err'] = np.clip((joined.mean_mz - joined.mz.fillna(0)) / mz_tol, -1, 1)
        a = joined.mean_ints
        b = joined.ints.fillna(0)
        mz_err = max(joined.mz_err.abs().sum(), 0.0001)
        # score = cosine_similarity(mean_ints, ints) / mz_err.sum()
        spectrum_scores[sp] = np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)) / mz_err
        if remove_bg:
            processed_spectra[sp] = joined[['sp', 'mz', 'ints']][~joined.ints.isna()]
        else:
            processed_spectra[sp] = grp

    # Return the best scoring spectrum
    best_sp = pd.Series(spectrum_scores).idxmax()
    logger.debug(f'Choose representative spectrum: {best_sp}')
    return processed_spectra[best_sp].sort_values('mz')


def hybrid_mean_spectrum(spectra_df, instrument, sigma_1, min_coverage=0):
    from msiwarp.util.warp import to_mz

    if not spectra_df.mz.is_monotonic_increasing:
        spectra_df = spectra_df.sort_values('mz')

    n_spectra = spectra_df.sp.nunique()
    mx_spectra = [
        to_mx_peaks(grp.mz, grp.ints, sigma_1, sp, instrument)
        for sp, grp in spectra_df.groupby('sp')
    ]
    logger.debug(f'Converted {sum(map(len, mx_spectra))} peaks to mx.peak')

    mean_spectrum = _get_mean_spectrum(mx_spectra, instrument, sigma_1)
    mean_spectrum_df = pd.DataFrame(
        {'mz': to_mz(mean_spectrum), 'ints': np.float32(to_height(mean_spectrum))}
    ).sort_values('mz')
    logger.debug(f'MSIWarp generate_mean_spectrum returned {len(mean_spectrum_df)} peaks')

    lo_mzs, hi_mzs = mass_accuracy_bounds(mean_spectrum_df.mz.values, instrument, sigma_1)

    lo_idxs = np.searchsorted(spectra_df.mz, lo_mzs, 'left')
    hi_idxs = np.searchsorted(spectra_df.mz, hi_mzs, 'right')
    results = []
    for lo_idx, hi_idx, mz_tol, mx_mz, mx_ints, lo_mz, hi_mz in zip(
        lo_idxs,
        hi_idxs,
        hi_mzs - lo_mzs,
        mean_spectrum_df.mz,
        mean_spectrum_df.ints,
        lo_mzs,
        hi_mzs,
    ):
        # if np.abs(mx_mz - 211.010248) < 0.005:
        #     print(lo_idx, hi_idx, mz_tol, mx_mz, mx_ints, lo_mz, hi_mz)
        #     sp_ids = spectra_df.sp.iloc[lo_idx:hi_idx].unique()
        #     print(f'sp_ids ({len(sp_ids)}):', sp_ids)
        #     print('n_spectra:', n_spectra)
        if hi_idx != lo_idx and hi_idx - lo_idx >= n_spectra * min_coverage:
            n_hits = spectra_df.sp.iloc[lo_idx:hi_idx].nunique()
            if n_hits >= n_spectra * min_coverage:
                mzs = spectra_df.mz.iloc[lo_idx:hi_idx]
                ints = spectra_df.ints.iloc[lo_idx:hi_idx]
                mz_mean, mz_stddev = weighted_stddev(mzs, ints)
                ints_mean = sum(ints) / n_spectra
                results.append(
                    {
                        'mz': mz_mean,
                        'mz_stddev': mz_stddev,
                        'mz_mx': mx_mz,
                        'mz_tol': mz_tol,
                        'ints': ints_mean,
                        'ints_stddev': np.sqrt(np.average((ints - ints_mean) ** 2)),
                        'ints_mx': mx_ints,
                        'coverage': n_hits / n_spectra,
                        'n_hits': n_hits,
                    }
                )

    logger.debug(f'Hybrid_mean_spectrum returned {len(results)} peaks (sigma_1: {sigma_1})')

    return pd.DataFrame(results)