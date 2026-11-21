* Topology-only PMOS bulk ties with the pin offset seen in the Frequency Divider
* @RNL(type="header") { @VERSION("0.4"); @USE-PACKAGE(name="rnl-std-all", version="0.4"); @DEVICE(name="*", model="pch_pdk", terminals=["d", "g", "s", "b"], type="pmos") }
.subckt bulk_pair VDD IN OUTA OUTB
XM3 OUTA IN VDD VDD pch_pdk w=1u l=0.15u
XM2 OUTB IN VDD VDD pch_pdk w=1u l=0.15u
* @RNL {
*   #XM3 @PLACE(51, -15); #XM2 @PLACE(69, -15);
*   &VDD @WIRE {#XM3:4 #XM2:4};
*   (69, -13.8) @ANNOTATION(rotate=270) $ARROW_SYMBOL;
*   &VDD @TEXT("VDD") => @PLACE(68.5, -13.6);
* }
.ends bulk_pair
