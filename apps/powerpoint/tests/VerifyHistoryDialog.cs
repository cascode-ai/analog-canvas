using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using CircuitCanvas;

class VerifyHistoryDialog {
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr window, uint command);
    static int checks;
    static void Check(bool value, string label) {
        if(!value)throw new Exception(label);
        checks++;
        Console.WriteLine("PASS "+label);
    }
    [STAThread] static int Main() {
        Exception failure=null;
        Application.EnableVisualStyles();
        Check(PowerPointWindow.Current()==null, "no active host window uses the safe fallback");
        using(var host=new Form {Text="History dialog verification"}) {
            bool started=false;
            host.Activated+=(s,e)=> {
                if(started)return;
                started=true;
                try {
                    var owner=PowerPointWindow.Current();
                    Check(owner!=null&&owner.Handle==host.Handle, "owner is the active window of the callback process");
                    var older=new Snapshot {time="2026-11-06 10:00:00",project="older"};
                    var drawing=new Drawing {history=new List<Snapshot> {new Snapshot {time="2026-11-06 11:00:00",project="latest"}, older}};
                    using(var history=new HistoryDialog(drawing)) {
                        history.Shown+=(sender,args)=> {
                            try {
                                Check(GetWindow(history.Handle,4)==host.Handle, "history dialog is owned by the host window");
                                var layout=(TableLayoutPanel)history.Controls[0];
                                var list=(ListBox)layout.GetControlFromPosition(0,1);
                                list.SelectedIndex=1;
                                history.AcceptButton.PerformClick();
                            } catch(Exception error) { failure=error; history.Close(); }
                        };
                        Check(history.ShowDialog(owner)==DialogResult.OK, "Open version accepts the selected history entry");
                        Check(history.SelectedSnapshot==older, "the selected older snapshot is returned unchanged");
                    }
                    using(var empty=new HistoryDialog(new Drawing())) {
                        Check(empty.SelectedSnapshot==null&&!((Button)empty.AcceptButton).Enabled, "empty history cannot open a nonexistent snapshot");
                    }
                } catch(Exception error) { failure=error; }
                host.Close();
            };
            Application.Run(host);
        }
        if(failure!=null) { Console.WriteLine(failure); return 1; }
        Console.WriteLine("TOTAL "+checks+" history dialog checks passed");
        return 0;
    }
}
