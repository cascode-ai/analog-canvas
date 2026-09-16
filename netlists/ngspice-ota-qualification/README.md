# ngspice acceptance Project

This is the ngspice Project from main `4cd84adc`, retained independently of the
editor example now authored in VACASK. The existing hosted ngspice qualification
uses its original Profile, source, circuit and tolerances. Loading its saved
schema goes through the normal Project loader; this is not a new migration path.

Do not retarget this fixture to VACASK. The native engine has separate native
input and runtime evidence; dual-engine support must not overwrite either
engine's acceptance source when changing the editor's example library.
