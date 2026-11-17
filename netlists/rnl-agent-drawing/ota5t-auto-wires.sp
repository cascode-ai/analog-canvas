* Five-transistor OTA in RNL 0.4 as an Agent writes it: every part placed, every wire pin to pin (auto)
.model nch nmos level=1
.model pch pmos level=1
M1 x inp tail 0 nch w=4u l=0.5u
M2 out inn tail 0 nch w=4u l=0.5u
M3 x x vdd vdd pch w=8u l=0.5u
M4 out x vdd vdd pch w=8u l=0.5u
M5 tail bias 0 0 nch w=8u l=1u
M6 bias bias 0 0 nch w=8u l=1u
Ib vdd bias 20u
CL out 0 1p
Vdd vdd 0 1.8
* @RNL(type="header") { @USE-PACKAGE(name="rnl-std-all", version="0.4"); @VERSION("0.4")}
* @RNL {
*   # @SELECT-INSTANCE(name="M*", recursive=true) => @SET-SYMBOL $NMOS;
*   # @SELECT-INSTANCE(type="pmos", recursive=true) => @SET-SYMBOL $PMOS;
*   &vdd @ADD-TO $SUPPLY_NET_SET;
*   #M1 @PLACE(-6, 0); #M2 @PLACE(6, 0) => @ORIENT("MY");
*   #M3 @PLACE(-6, 8) => @ORIENT("MY"); #M4 @PLACE(6, 8);
*   #M5 @PLACE(0, -6); #M6 @PLACE(-22, -6) => @ORIENT("MY"); #Ib @PLACE(-22, 0);
*   #CL @PLACE(16, 1); #Vdd @PLACE(28, 4);
*   &x @WIRE {#M3:1 #M1:1};
*   &x @WIRE {#M3:2 #M4:2};
*   &x @WIRE {#M3:1 #M3:2};
*   &out @WIRE {#M4:1 #M2:1};
*   &out @WIRE {#M4:1 #CL:1};
*   &tail @WIRE {#M1:3 #M5:1};
*   &tail @WIRE {#M2:3 #M5:1};
*   &bias @WIRE {#Ib:2 #M6:1};
*   &bias @WIRE {#M6:2 #M5:2};
*   &bias @WIRE {#M6:1 #M6:2};
*   %g5 = $GROUND @ATTACH #M5:3::net => @PLACE(0, -10); #M5:3::net @WIRE {#M5:3 %g5:p};
*   %g6 = $GROUND @ATTACH #M6:3::net => @PLACE(-22, -10); #M6:3::net @WIRE {#M6:3 %g6:p};
*   %gc = $GROUND @ATTACH #CL:2::net => @PLACE(16, -3); #CL:2::net @WIRE {#CL:2 %gc:p};
*   %gv = $GROUND @ATTACH #Vdd:2::net => @PLACE(28, -1); #Vdd:2::net @WIRE {#Vdd:2 %gv:p};
*   %s3 = $SUPPLY @ATTACH #M3:3::net => @PLACE(-6, 12); #M3:3::net @WIRE {#M3:3 %s3:p};
*   %s4 = $SUPPLY @ATTACH #M4:3::net => @PLACE(6, 12); #M4:3::net @WIRE {#M4:3 %s4:p};
*   %si = $SUPPLY @ATTACH #Ib:1::net => @PLACE(-22, 5); #Ib:1::net @WIRE {#Ib:1 %si:p};
*   %sv = $SUPPLY @ATTACH #Vdd:1::net => @PLACE(28, 9); #Vdd:1::net @WIRE {#Vdd:1 %sv:p}
* }
.end
