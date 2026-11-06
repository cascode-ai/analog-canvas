using System;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Xml;
using CircuitCanvas;
class VerifyTransparency  {
    static int count;
    static void Check(bool value,string label) {
        if(!value)throw new Exception(label);
        count++;
        Console.WriteLine("PASS "+label);
    }
    static XmlDocument Xml(string text) {
        var x=new XmlDocument {
            XmlResolver=null
        }
        ;
        x.LoadXml(text);
        return x;
    }
    [STAThread] static int Main(string[] args) {
        dynamic app=null,previous=null,deck=null;
        try {
            string folder=Path.GetFullPath(args[0]);
            Directory.CreateDirectory(folder);
            string receiptFolder=Path.Combine(folder,"receipt-retry");
            Directory.CreateDirectory(receiptFolder);
            string receiptPath=Path.Combine(receiptFolder,"ack.json");
            Directory.CreateDirectory(receiptPath);
            var receipt=new SaveReceipt();
            receipt.Record(7,true,null);
            Check(!receipt.TryPublish(receiptFolder),"temporarily blocked receipt remains pending");
            Directory.Delete(receiptPath);
            Check(receipt.TryPublish(receiptFolder)&&File.ReadAllText(receiptPath).Contains("\"sequence\":7"),"pending receipt is published after filesystem recovery");
            Check(receipt.TryPublish(receiptFolder),"completed receipt is not republished");
            string svg="<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'><rect x='0' y='0' width='20' height='20' fill='#fff'/><g data-layer='symbols'><circle cx='10' cy='10' r='5' fill='white' stroke='black'/></g></svg>";
            string transparent=Connect.TransparentPreview(svg);
            Check(Xml(transparent).DocumentElement.SelectNodes("*[local-name()='rect']").Count==0,"canvas page removed");
            Check(Xml(transparent).SelectSingleNode("//*[local-name()='circle']").Attributes["fill"].Value=="white","intentional symbol fill retained");
            Check(Connect.TransparentPreview(transparent)==transparent,"transparent export stays stable");
            foreach(string attribute in new[] {
                " id='user-box'"," transform='translate(0 0)'"," opacity='0.5'"
            }
            ) {
                string drawing=svg.Replace("fill='#fff'/>","fill='#fff'"+attribute+"/>");
                Check(Connect.TransparentPreview(drawing)==drawing,"identified or styled artwork preserved"+attribute);
            }
            Check(Connect.TransparentPreview(svg.Replace("width='20'","width='19'"))==svg.Replace("width='20'","width='19'"),"smaller rectangle preserved");
            string original=svg.Replace("0 0 20 20","-1.5 2.5 20 20").Replace("x='0' y='0'","x='-1.5' y='2.5'");
            var before=Xml(original);
            var after=Xml(Connect.TransparentPreview(original));
            Check(after.DocumentElement.SelectNodes("*[local-name()='rect']").Count==0,"fractional and negative viewBox exports have no white page");
            Check(before.DocumentElement.SelectSingleNode("*[local-name()='g']").OuterXml==after.DocumentElement.SelectSingleNode("*[local-name()='g']").OuterXml,"circuit artwork unchanged");
            app=Marshal.GetActiveObject("PowerPoint.Application");
            try {
                previous=app.ActiveWindow;
            }
            catch {
            }
            deck=app.Presentations.Add(-1);
            deck.PageSetup.SlideWidth=400;
            deck.PageSetup.SlideHeight=300;
            dynamic slide=deck.Slides.Add(1,12);
            slide.FollowMasterBackground=0;
            slide.Background.Fill.Solid();
            slide.Background.Fill.ForeColor.RGB=255;
            var result=new Result {
                protocol=1,project=File.ReadAllText(Path.Combine(folder,"empty.icproj.json")),svg=svg,documentId="document-main"
            }
            ;
            dynamic picture=Connect.Apply(app,slide,null,null,result,folder);
            picture.LockAspectRatio=0;
            picture.Left=50;
            picture.Top=50;
            picture.Width=200;
            picture.Height=200;
            picture.Rotation=17;
            dynamic other=slide.Shapes.AddShape(1,350,250,10,10);
            int stack=picture.ZOrderPosition;
            Check(Connect.Read(picture).current.svg==transparent,"embedded editable snapshot uses transparent SVG");
            string baseline=(string)typeof(Connect).GetMethod("ReadPayload",BindingFlags.NonPublic|BindingFlags.Static).Invoke(null,new object[] {
                picture
            }
            );
            picture=Connect.Apply(app,slide,picture,baseline,result,folder);
            Check(picture.Left==50&&picture.Top==50&&picture.Width==200&&picture.Height==200,"update preserves placement and size");
            Check(picture.Rotation==17&&picture.ZOrderPosition==stack,"update preserves rotation and stacking");
            Check(Connect.Read(picture).history.Count==1,"update preserves history");
            bool rejected=false;
            try {
                Connect.Apply(app,slide,picture,baseline,result,folder);
            }
            catch {
                rejected=true;
            }
            Check(rejected,"stale project baseline cannot overwrite the current drawing");
            for(int revision=0;revision<4;revision++) {
                baseline=(string)typeof(Connect).GetMethod("ReadPayload",BindingFlags.NonPublic|BindingFlags.Static).Invoke(null,new object[] { picture });
                picture=Connect.Apply(app,slide,picture,baseline,result,folder);
            }
            Check(Connect.Read(picture).history.Count==3,"history retains exactly three earlier snapshots");
            dynamic copy=picture.Duplicate()[1];
            Check(Connect.Read(copy).current.project==result.project,"copied picture retains its editable project");
            copy.Delete();
            picture.Rotation=0;
            string file=Path.Combine(folder,"transparent-export.pptx");
            deck.SaveAs(file);
            deck.Close();
            deck=null;
            deck=app.Presentations.Open(file,0,0,-1);
            slide=deck.Slides[1];
            picture=slide.Shapes[1];
            Check(Connect.Read(picture).current.project==result.project,"editable project survives save and reopen");
            File.WriteAllText(Path.Combine(folder,"reopened.icproj.json"),(string)Connect.Read(picture).current.project);
            string png=Path.Combine(folder,"transparent-export.png");
            slide.Export(png,"PNG",400,300);
            using(var bitmap=new Bitmap(png)) {
                Color corner=bitmap.GetPixel(60,60),center=bitmap.GetPixel(150,150);
                Check(corner.R>240&&corner.G<15&&corner.B<15,"red slide visible through exported picture background");
                Check(center.R>240&&center.G>240&&center.B>240,"intentional white symbol remains opaque");
            }
            Console.WriteLine("TOTAL "+count+" transparency checks passed");
            return 0;
        }
        catch(Exception e) {
            Console.WriteLine(e);
            return 1;
        }
        finally {
            if(deck!=null) {
                deck.Saved=-1;
                deck.Close();
            }
            if(previous!=null) {
                try {
                    previous.Activate();
                }
                catch {
                }
            }
        }
    }
}
