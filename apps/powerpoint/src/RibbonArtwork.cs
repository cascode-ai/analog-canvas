using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace CircuitCanvas {
    // Small native drawings keep Office icons consistent without external assets.
    internal sealed class RibbonArtwork : AxHost {
        static readonly Dictionary<string, object> pictures = new Dictionary<string, object>();
        static readonly List<Bitmap> bitmaps = new List<Bitmap>();
        RibbonArtwork() : base("") { }

        public static object Picture(string id) {
            object picture;
            if(pictures.TryGetValue(id, out picture))return picture;
            var bitmap = Draw(id);
            bitmaps.Add(bitmap);
            picture = GetIPictureDispFromPicture(bitmap);
            pictures.Add(id, picture);
            return picture;
        }

        public static Bitmap Draw(string id) {
            var bitmap = new Bitmap(64, 64);
            using(var g = Graphics.FromImage(bitmap))
            using(var pen = new Pen(Color.FromArgb(30, 94, 119), 2.1f))
            using(var accent = new Pen(Color.FromArgb(24, 130, 101), 2.4f)) {
                g.ScaleTransform(2, 2);
                g.SmoothingMode = SmoothingMode.AntiAlias;
                pen.StartCap = pen.EndCap = LineCap.Round;
                pen.LineJoin = LineJoin.Round;
                accent.StartCap = accent.EndCap = LineCap.Round;
                switch(id) {
                    case "newCircuit":
                        g.DrawRectangle(pen, 6, 7, 17, 17);
                        g.DrawLine(pen, 2, 12, 6, 12);
                        g.DrawLine(pen, 2, 19, 6, 19);
                        g.DrawLine(pen, 12, 3, 12, 7);
                        g.DrawLine(pen, 19, 3, 19, 7);
                        g.DrawLine(pen, 12, 24, 12, 28);
                        using(var white = new SolidBrush(Color.White))g.FillEllipse(white, 17, 17, 15, 15);
                        g.DrawLine(accent, 24, 18, 24, 29);
                        g.DrawLine(accent, 18.5f, 23.5f, 29.5f, 23.5f);
                        break;
                    case "editCircuit":
                        g.DrawLines(pen, new[] {new Point(19, 5), new Point(5, 5), new Point(5, 27), new Point(22, 27), new Point(22, 20)});
                        g.DrawPolygon(accent, new[] {new Point(13, 17), new Point(25, 5), new Point(29, 9), new Point(17, 21), new Point(11, 23)});
                        g.DrawLine(accent, 22, 8, 26, 12);
                        break;
                    case "exportCircuit":
                        g.DrawLines(pen, new[] {new Point(22, 10), new Point(22, 4), new Point(5, 4), new Point(5, 28), new Point(22, 28), new Point(22, 24)});
                        g.DrawLine(pen, 9, 9, 16, 9);
                        g.DrawLine(accent, 12, 17, 29, 17);
                        g.DrawLines(accent, new[] {new Point(24, 12), new Point(29, 17), new Point(24, 22)});
                        break;
                    case "historyCircuit":
                        g.DrawArc(pen, 5, 5, 23, 23, 210, 305);
                        g.DrawLines(accent, new[] {new Point(3, 5), new Point(4, 12), new Point(11, 11)});
                        g.DrawLine(pen, 16.5f, 10, 16.5f, 17);
                        g.DrawLine(pen, 16.5f, 17, 21.5f, 20);
                        break;
                    default:
                        g.DrawEllipse(pen, 4, 4, 24, 24);
                        using(var font = new Font("Segoe UI", 18, FontStyle.Bold, GraphicsUnit.Pixel))
                        using(var brush = new SolidBrush(pen.Color))
                        using(var format = new StringFormat {Alignment=StringAlignment.Center, LineAlignment=StringAlignment.Center})
                            g.DrawString("?", font, brush, new RectangleF(4, 2, 24, 27), format);
                        break;
                }
            }
            return bitmap;
        }
    }
}
