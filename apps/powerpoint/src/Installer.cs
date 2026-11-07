using System;
using System.IO;
using System.Reflection;
using System.Windows.Forms;
using Microsoft.Win32;
class Installer  {
    [STAThread] static int Main(string[] args) {
        bool quiet=Array.IndexOf(args,"/quiet")>=0;
        try {
            const string id="{26E88419-25E1-4B13-93BA-21F9BBA4D438}",prog="CircuitCanvas.Editor";
            string cls="Software\\Classes\\CLSID\\"+id,pid="Software\\Classes\\"+prog,office="Software\\Microsoft\\Office\\PowerPoint\\Addins\\"+prog;
            if(Array.IndexOf(args,"/uninstall")>=0) {
                foreach(var view in new[] {
                    RegistryView.Registry64,RegistryView.Registry32
                }
                )using(var user=RegistryKey.OpenBaseKey(RegistryHive.CurrentUser,view)) {
                    foreach(string key in new[] {
                        office,cls,pid
                    }
                    )user.DeleteSubKeyTree(key,false);
                }
                if(!quiet)MessageBox.Show("Circuit Canvas was unregistered. Embedded projects and local backups are retained.\nRestart PowerPoint to unload the add-in.","Circuit Canvas");
                return 0;
            }
            string root=Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location),dll=Path.Combine(root,"CircuitCanvas.dll");
            if(!File.Exists(dll)||!File.Exists(Path.Combine(root,"runtime","Analog-Canvas-Windows-x64","Analog Canvas Preview.exe")))throw new Exception("Extract the complete installation folder first.");
            var assembly=AssemblyName.GetAssemblyName(dll);
            foreach(var view in new[] {
                RegistryView.Registry64,RegistryView.Registry32
            }
            )using(var user=RegistryKey.OpenBaseKey(RegistryHive.CurrentUser,view)) {
                using(var key=user.CreateSubKey(cls))key.SetValue("","CircuitCanvas.Connect");
                using(var key=user.CreateSubKey(pid))key.SetValue("","CircuitCanvas.Connect");
                using(var key=user.CreateSubKey(cls+"\\InprocServer32")) {
                    key.SetValue("","mscoree.dll");
                    key.SetValue("ThreadingModel","Both");
                }
                foreach(string suffix in new[] {
                    "", "\\"+assembly.Version
                }
                )using(var key=user.CreateSubKey(cls+"\\InprocServer32"+suffix)) {
                    key.SetValue("Class","CircuitCanvas.Connect");
                    key.SetValue("Assembly",assembly.FullName);
                    key.SetValue("RuntimeVersion","v4.0.30319");
                    key.SetValue("CodeBase",new Uri(dll).AbsoluteUri);
                }
                using(var key=user.CreateSubKey(cls+"\\Implemented Categories\\{62C8FE65-4EBB-45E7-B440-6E39B2CDBF29}")) {
                }
                using(var key=user.CreateSubKey(cls+"\\ProgId"))key.SetValue("",prog);
                using(var key=user.CreateSubKey(pid+"\\CLSID"))key.SetValue("",id);
                using(var key=user.CreateSubKey(office)) {
                    key.SetValue("FriendlyName","Circuit Canvas");
                    key.SetValue("Description","Create and edit embedded circuit projects with the local Analog Canvas editor.");
                    key.SetValue("LoadBehavior",3,RegistryValueKind.DWord);
                    key.SetValue("CommandLineSafe",0,RegistryValueKind.DWord);
                }
            }
            if(!quiet)MessageBox.Show("Installation complete. Restart PowerPoint and open the Circuit Canvas tab.\nKeep this installation folder in place.","Circuit Canvas");
            return 0;
        }
        catch(Exception e) {
            if(!quiet)MessageBox.Show(e.Message,"Installation failed");
            return 1;
        }
    }
}
