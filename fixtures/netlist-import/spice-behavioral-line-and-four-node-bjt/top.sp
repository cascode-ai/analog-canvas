* b t q
.subckt top a b c d
B1 a b V=v(c)*2
T1 a 0 b 0 Z0=50 TD=1n
Q1 a b c d qmod
.ends top
