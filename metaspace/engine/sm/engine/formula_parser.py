import re

clean_regexp = re.compile(r'\.')
formula_regexp = re.compile(r'([A-Z][a-z]?)([0-9]*)')
adduct_split_regexp = re.compile(r'([+-]*)([A-Za-z0-9]+)')


class NegativeTotalElemError(Exception):
    def __init__(self, *args):
        self.message = str(args)


class FormulaHasNoElement(Exception):
    def __init__(self, *args):
        self.message = str(args)


def parse_formula(f):
    return [(elem, int(n or '1'))
            for (elem, n) in formula_regexp.findall(f)]


def ion_formula(formula, adduct):
    """ N.B.: Only single element adducts supported
    """
    ion_elements = []

    formula = clean_regexp.sub('', formula)
    charge, a_formula = adduct_split_regexp.findall(adduct)[0]
    for a_elem, a_n in parse_formula(a_formula):
        if charge == '+':
            matched = False
            for elem, n in parse_formula(formula):
                if elem == a_elem:
                    matched = True
                    n += a_n
                ion_elements.append((elem, n))
            if not matched:
                ion_elements.append((a_elem, 1))
        elif charge == '-':
            matched = False
            for elem, n in parse_formula(formula):
                if elem == a_elem:
                    matched = True
                    n -= a_n
                    if n < 0:
                        raise NegativeTotalElemError(formula, adduct)
                ion_elements.append((elem, n))
            if not matched:
                raise FormulaHasNoElement(formula, adduct)
        else:
            raise Exception('Adduct should be charged')

    ion_formula = ''
    for elem, n in ion_elements:
        ion_formula += elem
        if n > 1:
            ion_formula += str(n)

    return ion_formula
