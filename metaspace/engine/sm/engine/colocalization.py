import logging
import warnings
from datetime import datetime
from traceback import format_exc
import numpy as np
from sklearn.metrics.pairwise import pairwise_kernels
from sklearn.cluster import spectral_clustering
from scipy.ndimage import zoom

from sm.engine.dataset import Dataset
from sm.engine.ion_mapping import get_ion_id_mapping
from sm.engine.mol_db import MolecularDB
from sm.engine.util import SMConfig
from sm.engine.png_generator import ImageStoreServiceWrapper

COLOC_JOB_DEL = ('DELETE FROM graphql.coloc_job ' 
                 'WHERE ds_id = %s AND mol_db = %s')

COLOC_JOB_INS = ('INSERT INTO graphql.coloc_job (ds_id, mol_db, fdr, algorithm, start, finish, error, sample_ion_ids) ' 
                 'VALUES (%s, %s, %s, %s, %s, %s, %s, %s) ' 
                 'RETURNING id')

COLOC_ANN_INS = ('INSERT INTO graphql.coloc_annotation(coloc_job_id, ion_id, coloc_ion_ids, coloc_coeffs) ' 
                 'VALUES (%s, %s, %s, %s)')

SUCCESSFUL_COLOC_JOB_SEL = ('SELECT mol_db FROM graphql.coloc_job '
                            'WHERE ds_id = %s '
                            'GROUP BY mol_db '
                            'HAVING not bool_or(error IS NOT NULL)')

ANNOTATIONS_SEL = ('SELECT iso_image_ids[1], formula, chem_mod, neutral_loss, adduct, fdr '
                   'FROM annotation m '
                   'WHERE m.job_id = ('
                   '    SELECT id FROM job j '
                   '    WHERE j.ds_id = %s AND j.db_id = %s '
                   '    ORDER BY start DESC '
                   '    LIMIT 1) '
                   'ORDER BY msm DESC')

DATASET_CONFIG_SEL = ("SELECT config #> '{databases}', config #> '{isotope_generation,charge}' "
                      "FROM dataset "
                      "WHERE id = %s")

logger = logging.getLogger('engine')


class ColocalizationJob(object):
    def __init__(self, ds_id, mol_db, fdr, algorithm_name=None, start=None, finish=None,
                 error=None, ion_ids=None, sample_ion_ids=None, coloc_annotations=None):
        """
        Args
        ----------
        ds_id: str
        mol_db: str
        fdr: float
        algorithm_name: str
        start: datetime
        finish: datetime
        error: str
        ion_ids: list[int]
        sample_ion_ids: list[int]
            ids of ions that show distinctive localizations
        coloc_annotations: list[tuple[int, list[int], list[float]]]
            list of (base_ion_id, list(other_ion_ids), list(other_ion_scores))
        """
        assert error or all((algorithm_name, ion_ids is not None, sample_ion_ids is not None,
                             coloc_annotations is not None))

        self.ds_id = ds_id
        self.mol_db = mol_db
        self.fdr = fdr
        self.algorithm_name = algorithm_name or 'error'
        self.start = start or datetime.now()
        self.finish = finish or datetime.now()
        self.error = error
        self.ion_ids = ion_ids
        self.sample_ion_ids = sample_ion_ids or []
        self.coloc_annotations = coloc_annotations or []


class FreeableRef(object):
    def __init__(self, ref):
        self._ref = ref
        self._freed = False

    def free(self):
        self._ref = None
        self._freed = True

    @property
    def ref(self):
        if self._freed:
            raise ReferenceError('FreeableRef is already freed')
        else:
            return self._ref


def _labels_to_clusters(labels, scores):
    """ Converts from [0,1,0,1,2] form (mapping sample idx to cluster idx)
    to [[0,2],[1,3],[4]] form (mapping cluster idx to sample idx's).
    Each cluster is sorted based on items' distance from the cluster's mean
    """
    assert labels.shape[0] == scores.shape[0] == scores.shape[1], (labels.shape, scores.shape)

    in_same_cluster_mask = labels[:, np.newaxis] == labels[np.newaxis, :]
    typicalness = np.average(scores * scores, axis=1, weights=in_same_cluster_mask)
    clusters = [np.argwhere(labels == cid).ravel() for cid in np.unique(labels) if cid != -1]
    return [sorted(cluster, key=lambda i: -typicalness[i]) for cluster in clusters]


def _label_clusters(scores):
    n_samples = scores.shape[0]
    min_clusters = min(int(np.round(np.sqrt(n_samples))), 20)
    max_clusters = min(n_samples, 20)

    results = []
    last_error = None
    for n_clusters in range(min_clusters, max_clusters + 1):
        try:
            labels = spectral_clustering(affinity=scores, n_clusters=n_clusters, random_state=1, n_init=100)
            cluster_score = np.mean([scores[a, b] for a, b in enumerate(labels)])
            results.append((n_clusters, cluster_score, labels))
        except Exception as err:
            last_error = err

    if not results:
        raise last_error
    elif last_error:
        logger.warning('Warning: clustering failed on some cluster sizes', last_error)

    # Find the best cluster, subtracting n/1000 to add a slight preference to having fewer clusters
    best_cluster_idx = np.argmax([cs - n / 1000 for n, cs, l in results])
    best_n, best_cluster_score, best_labels = results[best_cluster_idx]
    logger.debug(f'best with {best_n} clusters (scores: {[(r[0], r[1]) for r in results]})')
    return best_labels


def _get_best_colocs(scores, max_samples, min_score):
    coloc_idxs = []
    for i in range(scores.shape[0]):
        pairing_scores = scores[i, :].copy()
        pairing_scores[pairing_scores < min_score] = 0  # Discard scores below threshold
        pairing_scores[i] = 0  # Ignore self-correlation

        num_above_min_score = np.count_nonzero(pairing_scores)
        num_to_keep = np.minimum(num_above_min_score, max_samples)

        coloc_idxs.append(list(np.argsort(pairing_scores)[::-1][:num_to_keep]))

    return coloc_idxs


def _format_coloc_annotations(ion_ids, scores, colocs):
    for i, js in enumerate(colocs):
        sorted_js = sorted(js, key=lambda j: -scores[i, j])
        base_ion_id = ion_ids.item(i)
        other_ion_ids = [ion_ids.item(j) for j in sorted_js]
        other_ion_scores = [scores.item((i,j)) for j in sorted_js]

        yield base_ion_id, other_ion_ids, other_ion_scores


def _downscale_image_if_required(img, num_annotations):
    # Aim for a maximum of 0.5 gigapixel (=2GB) total across the whole dataset,
    # as multiple copies are created during processing
    max_pixels = int(512 * 1024 * 1024 / num_annotations)

    zoom_factor = (max_pixels / (img.shape[0] * img.shape[1])) ** 0.5
    if zoom_factor > 1:
        return img
    with warnings.catch_warnings():
        # ignore "UserWarning: From scipy 0.13.0, the output shape of zoom() is calculated with round() instead of int()
        # - for these inputs the size of the returned array has changed."
        warnings.filterwarnings('ignore', '.*the output shape of zoom.*')
        return zoom(img, zoom_factor)


def analyze_colocalization(ds_id, mol_db, images, ion_ids, fdrs, cluster_max_images=5000):
    """ Calculate co-localization of ion images for all algorithms and yield results

    Args
    ----------
    ds_id: str
    mol_db: str
    images: FreeableRef[np.ndarray]
        2D array where each row contains the pixels from one image
        WARNING: This FreeableRef is released during use to save memory
    ion_ids: np.ndarray
        1D array where each item is the ion_id for the corresponding row in images
    fdrs: np.ndarray
        1D array where each item is the fdr for the corresponding row in images
    cluster_max_images: int
        maximum number of images used for clustering
    """
    assert images.ref.shape[1] >= 3
    assert images.ref.shape[0] == ion_ids.shape[0] == fdrs.shape[0], (images.ref.shape, ion_ids.shape, fdrs.shape)
    start = datetime.now()

    if len(ion_ids) < 2:
        logger.info('Not enough annotations to perform colocalization')
        return

    logger.debug('Calculating colocalization metrics')
    cos_scores = pairwise_kernels(images.ref, metric='cosine')
    images.free()

    trunc_ion_ids = ion_ids[:cluster_max_images]
    trunc_fdrs = fdrs[:cluster_max_images]

    for fdr in [0.05, 0.1, 0.2, 0.5]:
        fdr_mask = fdrs <= fdr + 0.001
        masked_ion_ids = ion_ids[fdr_mask]

        trunc_fdr_mask = trunc_fdrs <= fdr + 0.001
        trunc_masked_ion_ids = trunc_ion_ids[trunc_fdr_mask]

        if len(masked_ion_ids) > 1:
            logger.debug(f'Finding best colocalizations at FDR {fdr} ({len(masked_ion_ids)} annotations)')

            # NOTE: Keep labels/clusters between algorithms so that if any algorithm fails to cluster,
            # it can use the labels/clusters from a previous successful run.
            # Usually cosine succeeds at clustering and PCA data fails clustering.
            labels = [0] * len(masked_ion_ids)
            clusters = []

            def run_alg(algorithm, scores, cluster):
                nonlocal labels, clusters

                if cluster:
                    try:
                        trunc_scores = scores[:cluster_max_images, :cluster_max_images]
                        trunc_masked_scores = trunc_scores[trunc_fdr_mask, :][:, trunc_fdr_mask]
                        logger.debug(f'Clustering {algorithm} at {fdr} FDR with '
                                     f'{trunc_masked_scores.shape[0]} annotations')
                        labels = _label_clusters(trunc_masked_scores)
                        clusters = _labels_to_clusters(labels, trunc_masked_scores)
                    except Exception as err:
                        logger.warning(f'Failed to cluster {algorithm}: {err}', exc_info=True)

                masked_scores = scores if fdr_mask.all() else scores[fdr_mask, :][:, fdr_mask]
                colocs = _get_best_colocs(masked_scores, max_samples=100, min_score=0.3)
                sample_ion_ids = [trunc_masked_ion_ids.item(c[0]) for c in clusters]  # This could be done better
                coloc_annotations = list(_format_coloc_annotations(masked_ion_ids, masked_scores, colocs))
                return ColocalizationJob(ds_id, mol_db, fdr, algorithm, start, datetime.now(),
                                         ion_ids=masked_ion_ids.tolist(), sample_ion_ids=sample_ion_ids,
                                         coloc_annotations=coloc_annotations)

            yield run_alg('cosine', cos_scores, True)
        else:
            logger.debug(f'Skipping FDR {fdr} as there are only {len(masked_ion_ids)} annotation(s)')


class Colocalization(object):

    def __init__(self, db, img_store=None):
        self._db = db
        self._sm_config = SMConfig.get_conf()
        self._img_store = img_store or ImageStoreServiceWrapper(self._sm_config['services']['img_service_url'])

    def _save_job_to_db(self, job):
        job_id, = self._db.insert_return(COLOC_JOB_INS,
            [[job.ds_id, job.mol_db, job.fdr, job.algorithm_name, job.start, job.finish, job.error, job.sample_ion_ids]])

        annotations = [(job_id, *ann) for ann in job.coloc_annotations]
        self._db.insert(COLOC_ANN_INS, annotations)

    def _analyze_and_save(self, ds_id, mol_db, images, ion_ids, fdrs):
        try:
            # Clear old jobs from DB
            self._db.alter(COLOC_JOB_DEL, [ds_id, mol_db])

            if len(ion_ids) > 2:
                for job in analyze_colocalization(ds_id, mol_db, images, ion_ids, fdrs):
                    self._save_job_to_db(job)
            else:
                # Technically `len(ion_ids) == 2` is enough, but spearmanr returns a scalar instead of a matrix
                # when there are only 2 items, and it's not worth handling this edge case
                logger.info('Not enough annotations to perform colocalization')
        except Exception:
            logger.warning('Colocalization job failed', exc_info=True)
            self._save_job_to_db(ColocalizationJob(ds_id, mol_db, 0, error=format_exc()))
            raise

    def _get_existing_ds_annotations(self, ds_id, mol_db_name, image_storage_type, charge):
        mol_db = MolecularDB(name=mol_db_name)
        annotation_rows = self._db.select(ANNOTATIONS_SEL, [ds_id, mol_db.id])
        num_annotations = len(annotation_rows)
        if num_annotations != 0:
            ion_tuples = [(formula, chem_mod, neutral_loss, adduct)
                          for image, formula, chem_mod, neutral_loss, adduct, fdr in annotation_rows]
            ion_id_mapping = get_ion_id_mapping(self._db, ion_tuples, charge)
            ion_ids = np.array([ion_id_mapping[ion_tuple] for ion_tuple in ion_tuples])
            fdrs = np.array([row[5] for row in annotation_rows])

            logger.debug(f'Getting {num_annotations} images for "{ds_id}" {mol_db_name}')
            image_ids = [row[0] for row in annotation_rows]
            images, mask, (h, w) = self._img_store.get_ion_images_for_analysis(image_storage_type, image_ids)
            logger.debug(f'Finished getting images for "{ds_id}" {mol_db_name}. Image size: {h}x{w}')
        else:
            images = np.zeros((0, 0), dtype=np.float32)
            ion_ids = np.zeros((0,), dtype=np.int64)
            fdrs = np.zeros((0,), dtype=np.float32)

        return FreeableRef(images), ion_ids, fdrs

    def run_coloc_job(self, ds_id, reprocess=False):
        """ Analyze colocalization for a previously annotated dataset, querying the dataset's annotations from the db,
        and downloading the exported ion images
        Args
        ====
        ds_id: str
        reprocess: bool
            Whether to re-run colocalization jobs against databases that have already successfully run
        """

        image_storage_type = Dataset(ds_id).get_ion_img_storage_type(self._db)
        mol_dbs, charge = self._db.select_one(DATASET_CONFIG_SEL, [ds_id])
        existing_mol_dbs = set(db for db, in self._db.select(SUCCESSFUL_COLOC_JOB_SEL, [ds_id]))

        for mol_db_name in mol_dbs:
            if reprocess or mol_db_name not in existing_mol_dbs:
                logger.info(f'Running colocalization job for {ds_id} on {mol_db_name}')
                images, ion_ids, fdrs = self._get_existing_ds_annotations(ds_id, mol_db_name, image_storage_type, charge)
                self._analyze_and_save(ds_id, mol_db_name, images, ion_ids, fdrs)
            else:
                logger.info(f'Skipping colocalization job for {ds_id} on {mol_db_name}')
