import logging
from itertools import product

import numpy as np
import pandas as pd


logger = logging.getLogger('engine')

DECOY_ADDUCTS = ['+He', '+Li', '+Be', '+B', '+C', '+N', '+O', '+F', '+Ne', '+Mg', '+Al', '+Si', '+P', '+S', '+Cl', '+Ar', '+Ca', '+Sc', '+Ti', '+V', '+Cr', '+Mn', '+Fe', '+Co', '+Ni', '+Cu', '+Zn', '+Ga', '+Ge', '+As', '+Se', '+Br', '+Kr', '+Rb', '+Sr', '+Y', '+Zr', '+Nb', '+Mo', '+Ru', '+Rh', '+Pd', '+Ag', '+Cd', '+In', '+Sn', '+Sb', '+Te', '+I', '+Xe', '+Cs', '+Ba', '+La', '+Ce', '+Pr', '+Nd', '+Sm', '+Eu', '+Gd', '+Tb', '+Dy', '+Ho', '+Ir', '+Th', '+Pt', '+Os', '+Yb', '+Lu', '+Bi', '+Pb', '+Re', '+Tl', '+Tm', '+U', '+W', '+Au', '+Er', '+Hf', '+Hg', '+Ta']


def _make_target_modifiers_df(chem_mods, neutral_losses, target_adducts):
    """
    All combinations of chemical modification, neutral loss or target adduct.
    Note that the combination order matters as these target modifiers are used later to map back to separated
    chemical modification, neutral loss and target adduct fields.
    """
    df = pd.DataFrame(product(chem_mods, neutral_losses, target_adducts),
                      columns=['chem_mod', 'neutral_loss', 'target_adduct'])
    df = df.assign(target_modifier=df.chem_mod + df.neutral_loss + df.target_adduct)
    df = df.assign(decoy_modifier_prefix=df.chem_mod + df.neutral_loss)
    df = df.set_index('target_modifier')
    return df


class FDR(object):

    def __init__(self, decoy_sample_size, target_adducts, neutral_losses, chem_mods):
        self.decoy_sample_size = decoy_sample_size
        self.target_adducts = target_adducts
        self.neutral_losses = neutral_losses
        self.chem_mods = chem_mods
        self.td_df = None
        self.fdr_levels = [0.05, 0.1, 0.2, 0.5]
        self.random_seed = 42
        self.target_modifiers_df = _make_target_modifiers_df(chem_mods, neutral_losses, target_adducts)

    def _decoy_adduct_gen(self, target_formulas, decoy_adducts_cand):
        np.random.seed(self.random_seed)
        target_modifiers = list(self.target_modifiers_df.decoy_modifier_prefix.items())
        for formula, (tm, dmprefix) in product(target_formulas, target_modifiers):
            for da in np.random.choice(decoy_adducts_cand, size=self.decoy_sample_size, replace=False):
                yield (formula, tm, dmprefix + da)

    def decoy_adducts_selection(self, target_formulas):
        decoy_adduct_cand = [add for add in DECOY_ADDUCTS if add not in self.target_adducts]
        self.td_df = pd.DataFrame(self._decoy_adduct_gen(target_formulas, decoy_adduct_cand),
                                  columns=['formula', 'tm', 'dm'])

    def ion_tuples(self):
        """ 
        All ions needed for FDR calculation as a list of (formula, modifier), where modifier is a combination of
        chemical modification, neutral loss and adduct 
        """
        d_ions = self.td_df[['formula', 'dm']].drop_duplicates().values.tolist()
        t_ions = self.td_df[['formula', 'tm']].drop_duplicates().values.tolist()
        return list(map(tuple, t_ions + d_ions))

    def target_modifiers(self):
        """ List of possible modifier values for target ions """
        return self.target_modifiers_df.index.to_list()

    @staticmethod
    def _msm_fdr_map(target_msm, decoy_msm):
        target_msm_hits = pd.Series(target_msm.msm.value_counts(), name='target')
        decoy_msm_hits = pd.Series(decoy_msm.msm.value_counts(), name='decoy')
        msm_df = pd.concat([target_msm_hits, decoy_msm_hits], axis=1).fillna(0).sort_index(ascending=False)
        msm_df['target_cum'] = msm_df.target.cumsum()
        msm_df['decoy_cum'] = msm_df.decoy.cumsum()
        msm_df['fdr'] = msm_df.decoy_cum / msm_df.target_cum
        return msm_df.fdr

    def _digitize_fdr(self, fdr_df):
        df = fdr_df.copy().sort_values(by='msm', ascending=False)
        msm_levels = [df[df.fdr < fdr_thr].msm.min() for fdr_thr in self.fdr_levels]
        df['fdr_d'] = 1.
        for msm_thr, fdr_thr in zip(msm_levels, self.fdr_levels):
            row_mask = np.isclose(df.fdr_d, 1.) & np.greater_equal(df.msm, msm_thr)
            df.loc[row_mask, 'fdr_d'] = fdr_thr
        df['fdr'] = df.fdr_d
        return df.drop('fdr_d', axis=1)

    def estimate_fdr(self, formula_msm):
        logger.info('Estimating FDR')

        all_formula_msm_df = (pd.DataFrame(self.ion_tuples(), columns=['formula', 'modifier'])
                                .set_index(['formula', 'modifier']).sort_index())
        all_formula_msm_df = all_formula_msm_df.join(formula_msm).fillna(0)

        target_fdr_df_list = []
        for tm in self.target_modifiers_df.index:
            target_msm = all_formula_msm_df.loc(axis=0)[:, tm]
            full_decoy_df = self.td_df[self.td_df.tm == tm][['formula', 'dm']]

            msm_fdr_list = []
            for i in range(self.decoy_sample_size):
                decoy_subset_df = full_decoy_df[i::self.decoy_sample_size]
                sf_da_list = [tuple(row) for row in decoy_subset_df.values]
                decoy_msm = all_formula_msm_df.loc[sf_da_list]
                msm_fdr = self._msm_fdr_map(target_msm, decoy_msm)
                msm_fdr_list.append(msm_fdr)

            msm_fdr_avg = pd.Series(pd.concat(msm_fdr_list, axis=1).median(axis=1), name='fdr')
            target_fdr = self._digitize_fdr(target_msm.join(msm_fdr_avg, on='msm'))
            target_fdr_df_list.append(target_fdr.drop('msm', axis=1))

        return pd.concat(target_fdr_df_list, axis=0)
