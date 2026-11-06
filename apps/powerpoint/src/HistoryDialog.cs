using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Forms;

[assembly: System.Runtime.CompilerServices.InternalsVisibleTo("VerifyHistoryDialog")]

namespace CircuitCanvas {
    internal sealed class PowerPointWindow : IWin32Window {
        [DllImport("user32.dll")] static extern IntPtr GetActiveWindow();
        [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window, uint flags);
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
        public IntPtr Handle { get; private set; }
        PowerPointWindow(IntPtr handle) { Handle=handle; }
        public static IWin32Window Current() {
            // Ribbon callbacks run on the host UI thread. PowerPoint does not
            // consistently expose HWND through its late-bound Office object.
            IntPtr active=GetActiveWindow();
            if(active==IntPtr.Zero)return null;
            IntPtr root=GetAncestor(active, 2);
            if(root==IntPtr.Zero)return null;
            uint processId;
            GetWindowThreadProcessId(root, out processId);
            return processId==(uint)Process.GetCurrentProcess().Id ? new PowerPointWindow(root) : null;
        }
    }
    public sealed class HistoryDialog : Form {
        readonly List<Snapshot> snapshots;
        readonly ListBox versions;
        readonly Font versionFont = new Font("Segoe UI", 10, FontStyle.Bold);
        readonly Font dateFont = new Font("Segoe UI", 9);
        public Snapshot SelectedSnapshot {
            get { return versions.SelectedIndex < 0 ? null : snapshots[versions.SelectedIndex]; }
        }

        public HistoryDialog(Drawing drawing) {
            snapshots = drawing.history ?? new List<Snapshot>();
            Text = "Open history version";
            Font = new Font("Segoe UI", 10);
            BackColor = Color.White;
            ForeColor = Color.FromArgb(32, 43, 52);
            AutoScaleMode = AutoScaleMode.Dpi;
            ClientSize = new Size(560, 440);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = MinimizeBox = false;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.CenterParent;
            Padding = new Padding(24);

            var layout = new TableLayoutPanel {Dock=DockStyle.Fill, ColumnCount=1, RowCount=4, Margin=Padding.Empty};
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 64));
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 40));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 56));
            Controls.Add(layout);
            var header = new Panel {Dock=DockStyle.Fill, Margin=Padding.Empty};
            header.Controls.Add(new Label {Text="Selected circuit · Previous saves", AutoSize=false, Dock=DockStyle.Bottom, Height=26, ForeColor=Color.FromArgb(94, 107, 116)});
            header.Controls.Add(new Label {Text="Open history version", AutoSize=false, Dock=DockStyle.Top, Height=34, Font=new Font("Segoe UI", 16, FontStyle.Bold)});
            layout.Controls.Add(header, 0, 0);

            versions = new ListBox {
                Dock=DockStyle.Fill, BorderStyle=BorderStyle.None, BackColor=Color.FromArgb(246, 248, 250),
                DrawMode=DrawMode.OwnerDrawFixed, ItemHeight=72, IntegralHeight=false,
                AccessibleName="Saved versions", Margin=Padding.Empty
            };
            versions.DrawItem += DrawVersion;
            for(int i=0;i<snapshots.Count;i++)versions.Items.Add(VersionName(i)+" — "+SavedAt(i));
            layout.Controls.Add(versions, 0, 1);
            if(snapshots.Count>0)versions.SelectedIndex=0;
            else {
                var empty = new Label {
                    Text="No earlier versions yet.\nSave changes to PowerPoint to create a version.",
                    Dock=DockStyle.Fill, TextAlign=ContentAlignment.MiddleCenter,
                    BackColor=versions.BackColor, ForeColor=Color.FromArgb(94, 107, 116)
                };
                versions.Controls.Add(empty);
            }
            layout.Controls.Add(new Label {
                Text="The slide changes only after you save from the editor.", Dock=DockStyle.Fill,
                TextAlign=ContentAlignment.MiddleLeft, ForeColor=Color.FromArgb(94, 107, 116),
                Font=dateFont, Margin=Padding.Empty
            }, 0, 2);
            var buttons = new FlowLayoutPanel {Dock=DockStyle.Fill, FlowDirection=FlowDirection.RightToLeft, Padding=new Padding(0, 10, 0, 0), Margin=Padding.Empty};
            var open = new Button {
                Text="Open version", AutoSize=false, Size=new Size(132, 38), FlatStyle=FlatStyle.Flat,
                BackColor=Color.FromArgb(23, 109, 85), ForeColor=Color.White,
                Enabled=snapshots.Count>0, Margin=new Padding(10, 0, 0, 0)
            };
            open.FlatAppearance.BorderSize=0;
            open.Click+=(s,e)=>OpenVersion();
            var cancel = new Button {Text="Cancel", Size=new Size(94, 38), FlatStyle=FlatStyle.Flat, DialogResult=DialogResult.Cancel, Margin=Padding.Empty};
            cancel.FlatAppearance.BorderColor=Color.FromArgb(212, 220, 226);
            buttons.Controls.Add(open);
            buttons.Controls.Add(cancel);
            layout.Controls.Add(buttons, 0, 3);
            AcceptButton=open;
            CancelButton=cancel;
            versions.DoubleClick+=(s,e)=>OpenVersion();
            Shown+=(s,e)=>versions.Focus();
        }

        void OpenVersion() {
            if(SelectedSnapshot==null)return;
            DialogResult=DialogResult.OK;
            Close();
        }
        string VersionName(int index) { return index==0 ? "Previous save" : (index+1)+" saves ago"; }
        string SavedAt(int index) {
            DateTime time;
            return DateTime.TryParseExact(snapshots[index].time, "yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture, DateTimeStyles.None, out time)
                ? time.ToString("dd MMM yyyy  ·  HH:mm:ss", CultureInfo.GetCultureInfo("en-US"))
                : snapshots[index].time ?? "Saved time unavailable";
        }
        void DrawVersion(object sender, DrawItemEventArgs e) {
            if(e.Index<0)return;
            bool selected=(e.State&DrawItemState.Selected)!=0;
            var box=new Rectangle(e.Bounds.X+2, e.Bounds.Y+3, e.Bounds.Width-4, e.Bounds.Height-6);
            using(var background=new SolidBrush(selected ? Color.FromArgb(229, 243, 237) : Color.White))e.Graphics.FillRectangle(background, box);
            using(var border=new Pen(selected ? Color.FromArgb(23, 109, 85) : Color.FromArgb(225, 231, 235)))e.Graphics.DrawRectangle(border, box);
            TextRenderer.DrawText(e.Graphics, VersionName(e.Index), versionFont, new Rectangle(box.X+16, box.Y+10, box.Width-32, 24), ForeColor, TextFormatFlags.EndEllipsis);
            TextRenderer.DrawText(e.Graphics, SavedAt(e.Index), dateFont, new Rectangle(box.X+16, box.Y+36, box.Width-32, 22), Color.FromArgb(94, 107, 116), TextFormatFlags.EndEllipsis);
            if((e.State&DrawItemState.Focus)!=0)e.DrawFocusRectangle();
        }
        protected override void Dispose(bool disposing) {
            base.Dispose(disposing);
            if(disposing) { versionFont.Dispose(); dateFont.Dispose(); }
        }
    }
}
