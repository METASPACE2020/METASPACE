import re
from collections import Counter

clean_regexp = re.compile(r'[.=]')
formula_regexp = re.compile(r'([A-Z][a-z]*)([0-9]*)')
adduct_validate_regexp = re.compile(r'^([+-]([A-Z][a-z]*[0-9]*)+)+$')
adduct_regexp = re.compile(r'([+-])([A-Za-z0-9]+)')


class ParseFormulaError(Exception):
    def __init__(self, message):
        self.message = message


def parse_formula(f):
    return [(elem, int(n or '1')) for (elem, n) in formula_regexp.findall(f)]


def _hill_system_sort(ion_elements):
    """ Reorder elements to be consistently ordered per https://en.wikipedia.org/wiki/Chemical_formula#Hill_system """
    if ion_elements['C'] != 0:
        return ['C', 'H', *sorted(key for key in ion_elements.keys() if key not in ('C', 'H'))]
    else:
        return sorted(key for key in ion_elements.keys())


def _chnops_sort(ion_elements):
    """ Reorder elements to be consistently ordered per the method in pyMSpec """
    return [*'CHNOPS', *sorted(key for key in ion_elements.keys() if len(key) > 1 or key not in 'CHNOPS')]


def format_modifiers(*adducts):
    return ''.join(adduct for adduct in adducts if adduct and adduct not in ('[M]+', '[M]-'))


def format_charge(charge):
    if not charge:
        return ''
    if charge == 1:
        return '+'
    if charge == -1:
        return '-'
    return format(int(charge), '+0')


def format_ion_formula(formula, *adducts, charge=None):
    # Ideally this should put square brackets around the formula + adducts, however that will require
    # more extensive changes and migration of existing data
    return formula + format_modifiers(*adducts) + format_charge(charge)


def generate_ion_formula(formula, *adducts):
    """
    Calculates the resulting molecular formula after applying a set of transformations,
    e.g. `generate_ion_formula('H2O', '+H', '-O')` => `'H3'`
    Throws an error if any component isn't formatted correctly, or if any step of the transformation sequence would
    create an impossible molecule with no elements, or a negative quantity of any element.

    Args
    ----
        formula: str
        adducts: str

    Returns
    -------
        str
    """
    formula = clean_regexp.sub('', formula)
    adducts = [adduct for adduct in adducts if adduct]

    ion_elements = Counter(dict(parse_formula(formula)))

    for adduct in adducts:
        if adduct in ('[M]+', '[M]-'):
            # In order to support more complex adducts in the future, this should move away from using plain formulas like "+H",
            # and instead adopt a comprehensive description format that supports transformations like [2M3C13+Na+H+5.109]2+
            # (Dimeric form of molecule with 3 atoms labelled with C13, Na and H adducts, an unknown +5.109 mass shift and charge=+2)
            # However this would require significant changes to the rest of the pipeline. For now [M]+ and [M]- are just treated as special-cases.
            continue
        if not adduct_validate_regexp.match(adduct):
            raise ParseFormulaError(f'Invalid adduct: {adduct}')
        for op, adduct_part in adduct_regexp.findall(adduct):
            assert op in ('+', '-'), 'Adduct should be prefixed with + or -'
            for elem, n in parse_formula(adduct_part):
                if op == '+':
                    ion_elements[elem] += n
                else:
                    ion_elements[elem] -= n
                    if ion_elements[elem] < 0:
                        raise ParseFormulaError(f'Negative total element count for {elem}')

    if not any(count > 0 for count in ion_elements.values()):
        raise ParseFormulaError('No remaining elements')

    # element_order = _hill_system_sort(ion_elements)
    element_order = _chnops_sort(ion_elements)

    ion_formula_parts = []
    for elem in element_order:
        count = ion_elements[elem]
        if count != 0:
            ion_formula_parts.append(elem)
            if count > 1:
                ion_formula_parts.append(str(count))

    return ''.join(ion_formula_parts)


def safe_generate_ion_formula(*parts):
    try:
        return generate_ion_formula(*(part for part in parts if part))
    except ParseFormulaError:
        return None
