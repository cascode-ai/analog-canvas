* A divider whose middle node and input are named by net labels
R1 in mid 1k
R2 mid 0 1k
* @RNL(type="header") { @USE-PACKAGE(name="rnl-std-all", version="0.4"); @VERSION("0.4")}
* @RNL {
*   #R1 @PLACE(0, 4); #R2 @PLACE(0, -4);
*   %j = (0, 0);
*   &mid @WIRE {#R1:2 %j #R2:1};
*   $JUNCTION @ATTACH %j => @PLACE(0, 0);
*   %lm = $NET_LABEL @ATTACH &mid => @PLACE(4, 0) => @ORIENT("R180");
*   &mid @WIRE {%j %lm:p};
*   %li = $NET_LABEL @ATTACH &in => @PLACE(0, 9);
*   &in @WIRE {#R1:1 %li:p};
*   %g = $GROUND @ATTACH #R2:2::net => @PLACE(0, -9); #R2:2::net @WIRE {#R2:2 %g:p}
* }
.end
