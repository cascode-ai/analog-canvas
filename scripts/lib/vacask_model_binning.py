"""Lower the pinned source model's bin selection into native VACASK guards.

This is an offline conversion rule, not a second executable simulator. ngspice
46 inpgmod.c accepts either edge within 1e-9 m; inpmkmod.c prepends model cards,
so the last declared matching card wins. The hosted source Profile has no
HSPICE/Spectre compatibility mode and therefore defaults wnflag to zero.
"""


def source_bin_guards(values, boundaries):
    """Return (original declaration index, native condition) in search order."""
    length = '(' + values['l'] + ')*$scale'
    # W/NF is used for *bin selection* only when explicitly requested. This
    # does not change W, NF, or the compact model's own finger geometry.
    width = '(' + values['w'] + ')*$scale'
    if 'wnflag' in values:
        width += '/((' + values['wnflag'] + ')==0?1:(' + values.get('nf', '1') + '))'

    def inside(value, low, high):
        return (f'(abs(({value})-({low}))<1e-9 || '
                f'abs(({value})-({high}))<1e-9 || '
                f'(({low})<({value}) && ({value})<({high})))')

    result = []
    for index in reversed(range(len(boundaries))):
        lmin, lmax, wmin, wmax = boundaries[index]
        result.append((index, inside(length, lmin, lmax) + ' && ' + inside(width, wmin, wmax)))
    return result
