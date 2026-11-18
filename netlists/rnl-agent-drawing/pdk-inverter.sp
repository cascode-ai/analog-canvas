* An inverter of PDK subcircuit calls, as an Agent writes it: devices declared with their terminals, VDD and VSS drawn as supply and ground
* @RNL(type="header") { @USE-PACKAGE(name="rnl-std-all", version="0.4"); @VERSION("0.4"); @DEVICE(name="*", model="nch*", terminals=["d", "g", "s", "b"], type="nmos"); @DEVICE(name="*", model="pch*", terminals=["d", "g", "s", "b"], type="pmos")}
.subckt inv VDD VSS IN OUT
XMP OUT IN VDD VDD pch_pdk w=1u l=0.15u
XMN OUT IN VSS VSS nch_pdk w=0.5u l=0.15u
* @RNL {
*   #XMP @PLACE(0, 4); #XMN @PLACE(0, -4);
*   %cs = #XMN(device) @AS $COMMON_SOURCE;
*   %jo = (0, 0); $JUNCTION @ATTACH %jo => @PLACE(0, 0);
*   %ji = (-5, 0); $JUNCTION @ATTACH %ji => @PLACE(-5, 0);
*   &OUT @WIRE {#XMP:1 %jo #XMN:1};
*   &IN @WIRE {#XMP:2 (-5, 4) %ji (-5, -4) #XMN:2};
*   %pi = $IO_PORT @ATTACH &IN => @PLACE(-8, 0); &IN @WIRE {%pi:p %ji};
*   %po = $IO_PORT @ATTACH &OUT => @PLACE(4, 0) => @ORIENT("R180"); &OUT @WIRE {%jo %po:p};
*   %s = $SUPPLY @ATTACH &VDD => @PLACE(0, 8); &VDD @WIRE {#XMP:3 %s:p};
*   %g = $GROUND @ATTACH &VSS => @PLACE(0, -8); &VSS @WIRE {#XMN:3 %g:p}
* }
.ends inv
