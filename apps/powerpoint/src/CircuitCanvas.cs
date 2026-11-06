using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using System.Xml;
using Office = Microsoft.Office.Core;
using Extensibility;
[assembly: ComVisible(false)] [assembly: System.Reflection.AssemblyVersion("2.1.2.0")] namespace CircuitCanvas  {
    [ComVisible(true), Guid("48CA2B08-BB3C-45AB-A982-5B19168732B9"), InterfaceType(ComInterfaceType.InterfaceIsIDispatch)] public interface ICallbacks  {
        [DispId(10)] void OnNew(Office.IRibbonControl c);
        [DispId(11)] void OnEdit(Office.IRibbonControl c);
        [DispId(12)] void OnReceive(Office.IRibbonControl c);
        [DispId(13)] void OnExport(Office.IRibbonControl c);
        [DispId(14)] void OnHistory(Office.IRibbonControl c);
        [DispId(15)] void OnHelp(Office.IRibbonControl c);
        [DispId(16)] [return: MarshalAs(UnmanagedType.IDispatch)] object GetButtonImage(Office.IRibbonControl c);
    }
    public class Snapshot  {
        public string project  {
            get;
            set;
        }
        public string svg  {
            get;
            set;
        }
        public string time  {
            get;
            set;
        }
        public string documentId  {
            get;
            set;
        }
    }
    public class Drawing  {
        public int version  {
            get;
            set;
        }
        public string id  {
            get;
            set;
        }
        public Snapshot current  {
            get;
            set;
        }
        public List<Snapshot> history  {
            get;
            set;
        }
    }
    public class Result  {
        public int protocol  {
            get;
            set;
        }
        public string token  {
            get;
            set;
        }
        public int sequence  {
            get;
            set;
        }
        public string project  {
            get;
            set;
        }
        public string svg  {
            get;
            set;
        }
        public string documentId  {
            get;
            set;
        }
    }
    // A failed receipt write must never cause an already applied drawing to be applied twice.
    public class SaveReceipt {
        string pending;
        public void Record(int sequence, bool ok, string error) {
            pending = new JavaScriptSerializer().Serialize(new { sequence=sequence, ok=ok, error=error });
        }
        public bool TryPublish(string folder) {
            if(pending==null)return true;
            try {
                string target=Path.Combine(folder,"ack.json"),temporary=target+".tmp";
                File.WriteAllText(temporary,pending,new UTF8Encoding(false));
                if(File.Exists(target))File.Replace(temporary,target,null);
                else File.Move(temporary,target);
                pending=null;
                return true;
            }
            catch(IOException) { return false; }
            catch(UnauthorizedAccessException) { return false; }
        }
    }
    [ComVisible(true), Guid("26E88419-25E1-4B13-93BA-21F9BBA4D438"), ProgId("CircuitCanvas.Editor"), ClassInterface(ClassInterfaceType.None), ComDefaultInterface(typeof(ICallbacks))] public class Connect : IDTExtensibility2, Office.IRibbonExtensibility, ICallbacks  {
        public Connect() {
            TraceLoad("Constructed");
        }
        static void TraceLoad(string stage) {
            try {
                Directory.CreateDirectory(Data);
                File.AppendAllText(Path.Combine(Data,"addin-load.log"),DateTime.Now.ToString("s")+" pid="+Process.GetCurrentProcess().Id+" "+stage+Environment.NewLine);
            }
            catch {
            }
        }
        dynamic app;
        Session session;
        Timer timer;
        const string Ns="urn:circuit-canvas:powerpoint:2";
        public static string Root  {
            get {
                return Path.GetDirectoryName(typeof(Connect).Assembly.Location);
            }
        }
        public static string Data  {
            get {
                return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"CircuitCanvas");
            }
        }
        static JavaScriptSerializer Json() {
            return new JavaScriptSerializer {
                MaxJsonLength=64*1024*1024,RecursionLimit=200
            }
            ;
        }
        class Session  {
            public dynamic slide;
            public dynamic shape;
            public string baseline;
            public string folder;
            public string token;
            public int sequence;
            public SaveReceipt receipt=new SaveReceipt();
            public Process process;
        }
        public void OnConnection(object application,ext_ConnectMode mode,object addin,ref Array custom) {
            TraceLoad("OnConnection "+mode);
            try {
                app=application;
                timer=new Timer {
                    Interval=750
                }
                ;
                timer.Tick+=(s,e)=>Receive(false);
                timer.Start();
                TraceLoad("Connected");
            }
            catch(Exception e) {
                TraceLoad("Connection failed: "+e);
                throw;
            }
        }
        public void OnDisconnection(ext_DisconnectMode mode,ref Array custom) {
            TraceLoad("OnDisconnection "+mode);
            if(timer!=null) {
                timer.Stop();
                timer.Dispose();
            }
            app=null;
        }
        public void OnAddInsUpdate(ref Array custom) {
        }
        public void OnStartupComplete(ref Array custom) {
            TraceLoad("Startup complete");
        }
        public void OnBeginShutdown(ref Array custom) {
            TraceLoad("Shutdown");
            if(timer!=null)timer.Stop();
        }
        public string GetCustomUI(string id) {
            return @"<customUI xmlns='http://schemas.microsoft.com/office/2009/07/customui'>
<ribbon><tabs><tab id='CircuitCanvasTab' label='Circuit Canvas'>
<group id='canvasEdit' label='Circuit'>
<button id='newCircuit' label='New circuit' size='large' getImage='GetButtonImage' onAction='OnNew' screentip='Create a circuit on this slide'/>
<button id='editCircuit' label='Edit circuit' size='large' getImage='GetButtonImage' onAction='OnEdit' screentip='Edit the selected circuit'/>
</group>
<group id='canvasData' label='Selected circuit'>
<button id='exportCircuit' label='Export selected circuit' getImage='GetButtonImage' onAction='OnExport' screentip='Export the selected circuit as an editable project' supertip='Save the selected circuit’s embedded project as an .icproj.json file.'/>
<button id='historyCircuit' label='Open history version' getImage='GetButtonImage' onAction='OnHistory' screentip='Open an earlier version of the selected circuit' supertip='Choose one of the three previous saves to open in the editor. The slide changes only when you save back to PowerPoint.'/>
</group>
<group id='canvasHelp' label='Help'>
<button id='helpCircuit' label='Help' size='large' getImage='GetButtonImage' onAction='OnHelp'/>
</group>
</tab></tabs></ribbon></customUI>";
        }
        public object GetButtonImage(Office.IRibbonControl c) { return RibbonArtwork.Picture(c.Id); }
        void Guard(Action action) {
            try {
                action();
            }
            catch(Exception e) {
                MessageBox.Show(e.Message,"Circuit Canvas",MessageBoxButtons.OK,MessageBoxIcon.Information);
            }
        }
        dynamic Slide() {
            if(app.Presentations.Count==0)throw new Exception("Open a presentation and select a slide first.");
            try {
                return app.ActiveWindow.View.Slide;
            }
            catch {
                throw new Exception("Switch to Normal editing view.");
            }
        }
        dynamic Selected() {
            if(app.ActiveWindow.Selection.Type!=2||app.ActiveWindow.Selection.ShapeRange.Count!=1)throw new Exception("Select one drawing created by Circuit Canvas.");
            return app.ActiveWindow.Selection.ShapeRange[1];
        }
        public void OnNew(Office.IRibbonControl c) {
            Guard(()=>Start(Slide(),null,null));
        }
        public void OnEdit(Office.IRibbonControl c) {
            Guard(()=> {
                dynamic shape=Selected();Drawing drawing=Read(shape);Start(Slide(),shape,drawing.current.project,drawing.current.documentId);
            }
            );
        }
        public void OnReceive(Office.IRibbonControl c) {
            Receive(true);
        }
        public void OnExport(Office.IRibbonControl c) {
            Guard(()=> {
                Drawing d=Read(Selected());using(var dialog=new SaveFileDialog {
                    Title="Export selected circuit",Filter="Analog Canvas project|*.icproj.json",FileName="circuit.icproj.json"
                }
                )if(dialog.ShowDialog()==DialogResult.OK)File.WriteAllText(dialog.FileName,d.current.project,new UTF8Encoding(false));
            }
            );
        }
        public void OnHelp(Office.IRibbonControl c) {
            Process.Start(Path.Combine(Root,"README.html"));
        }
        public void OnHistory(Office.IRibbonControl c) {
            Guard(()=> {
                dynamic shape=Selected();Drawing drawing=Read(shape);
                dynamic slide=Slide();
                using(var form=new HistoryDialog(drawing)) {
                    var owner=PowerPointWindow.Current();
                    if(owner==null)form.StartPosition=FormStartPosition.CenterScreen;
                    if(form.ShowDialog(owner)==DialogResult.OK&&form.SelectedSnapshot!=null)
                        Start(slide,shape,form.SelectedSnapshot.project,form.SelectedSnapshot.documentId);
                }
            }
            );
        }
        void Start(dynamic slide,dynamic shape,string project,string documentId=null) {
            if(session!=null&&File.Exists(Path.Combine(session.folder,"editor.pid"))) {
                try {
                    int pid=Int32.Parse(File.ReadAllText(Path.Combine(session.folder,"editor.pid")));
                    if(!Process.GetProcessById(pid).HasExited)throw new InvalidOperationException("A circuit editor is already open. Close it before editing another drawing.");
                }
                catch(ArgumentException) {
                }
            }
            if(session!=null&&session.process!=null&&!session.process.HasExited)throw new Exception("Save the current drawing to PowerPoint and close its editor before opening another drawing.");
            if(session!=null)Receive(false);
            string exe=Path.Combine(Root,"runtime","Analog-Canvas-Windows-x64","Analog Canvas Preview.exe");
            if(!File.Exists(exe))throw new Exception("The local editor is missing. Keep the installation folder intact.");
            string token=Guid.NewGuid().ToString("N"),folder=Path.Combine(Data,"Sessions",token);
            Directory.CreateDirectory(folder);
            if(project==null) {
                var seed=Json().Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(Root,"empty.icproj.json")));
                seed["id"]=Guid.NewGuid().ToString("N");
                project=Json().Serialize(seed);
            }
            File.WriteAllText(Path.Combine(folder,"session.json"),Json().Serialize(new {
                token=token,documentId=documentId
            }
            ),new UTF8Encoding(false));
            File.WriteAllText(Path.Combine(folder,"drawing.icproj"),project,new UTF8Encoding(false));
            var start=new ProcessStartInfo(exe,"--open-project \""+Path.Combine(folder,"drawing.icproj")+"\"") {
                UseShellExecute=false,WorkingDirectory=Path.GetDirectoryName(exe)
            }
            ;
            start.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
            start.EnvironmentVariables.Remove("ICM_PREVIEW_WAIT_FOR_DRIVER");
            start.EnvironmentVariables["CIRCUIT_PPT_SESSION"]=folder;
            start.EnvironmentVariables["ICM_PREVIEW_USER_DATA"]=Path.Combine(folder,"editor-data");
            start.EnvironmentVariables["ICM_DESKTOP_PROJECTS"]=Path.Combine(Data,"Projects");
            start.EnvironmentVariables["CIRCUIT_PPT_COMPONENTS"]=Path.Combine(Data,"components.json");
            session=new Session {
                slide=slide,shape=shape,baseline=shape==null?null:ReadPayload(shape),folder=folder,token=token
            }
            ;
            session.process=Process.Start(start);
        }
        static string ReadPayload(dynamic shape) {
            foreach(dynamic part in shape.CustomerData) {
                string xml=(string)part.XML;
                var doc=new XmlDocument {
                    XmlResolver=null
                }
                ;
                doc.LoadXml(xml);
                if(doc.DocumentElement.NamespaceURI==Ns)return Encoding.UTF8.GetString(Convert.FromBase64String(doc.DocumentElement.InnerText));
            }
            throw new Exception("The selected shape does not contain an editable Circuit Canvas project.");
        }
        public static Drawing Read(object shape) {
            Drawing d=Json().Deserialize<Drawing>(ReadPayload(shape));
            if(d.version!=2||d.current==null)throw new Exception("This embedded circuit project version is not supported.");
            return d;
        }
        // The renderer emits its white page as an unlabelled, direct-child rect.
        // User artwork is inside named layers; never remove its white fills.
        public static string TransparentPreview(string svg) {
            var document=new XmlDocument {
                XmlResolver=null
            }
            ;
            document.LoadXml(svg);
            var root=document.DocumentElement;
            if(root.LocalName!="svg"||root.NamespaceURI!="http://www.w3.org/2000/svg")throw new Exception("The editor returned an invalid SVG.");
            string[] bounds=root.GetAttribute("viewBox").Split(new[] {
                ' ', ',', '\t', '\r', '\n'
            }
            ,StringSplitOptions.RemoveEmptyEntries);
            double[] box=new double[4];
            if(bounds.Length!=4)return svg;
            for(int i=0;i<4;i++)if(!Double.TryParse(bounds[i],System.Globalization.NumberStyles.Float,System.Globalization.CultureInfo.InvariantCulture,out box[i])||Double.IsNaN(box[i])||Double.IsInfinity(box[i]))return svg;
            foreach(XmlNode child in root.ChildNodes.Cast<XmlNode>().ToArray()) {
                var rect=child as XmlElement;
                if(rect==null||rect.LocalName!="rect"||rect.NamespaceURI!=root.NamespaceURI||rect.Attributes.Count!=5)continue;
                string fill=rect.GetAttribute("fill");
                if(fill!="#fff"&&fill!="#ffffff"&&fill!="white")continue;
                string[] names= {
                    "x","y","width","height"
                }
                ;
                bool matches=true;
                for(int i=0;i<4;i++) {
                    double value;
                    if(!Double.TryParse(rect.GetAttribute(names[i]),System.Globalization.NumberStyles.Float,System.Globalization.CultureInfo.InvariantCulture,out value)||value!=box[i]) {
                        matches=false;
                        break;
                    }
                }
                if(matches) {
                    root.RemoveChild(rect);
                    return document.OuterXml;
                }
            }
            return svg;
        }
        static void Embed(dynamic shape,Drawing drawing) {
            string payload=Convert.ToBase64String(Encoding.UTF8.GetBytes(Json().Serialize(drawing)));
            dynamic part=shape.CustomerData.Add();
            if(!part.LoadXML("<drawing xmlns='"+Ns+"'>"+payload+"</drawing>"))throw new Exception("The project could not be embedded in the picture.");
            shape.Tags.Add("CircuitCanvas","2");
            shape.AlternativeText="Editable circuit: select this picture, then choose Circuit Canvas > Edit circuit.";
        }
        public static object Apply(object application,object slideObject,object oldObject,string expected,Result result,string folder) {
            dynamic applicationDynamic=application,slide=slideObject,old=oldObject;
            Drawing prior=null;
            if(old!=null) {
                string actual=ReadPayload(old);
                if(actual!=expected)throw new Exception("The drawing changed in PowerPoint. Reopen it before saving to avoid overwriting a newer version.");
                prior=Json().Deserialize<Drawing>(actual);
            }
            if(result.protocol!=1||String.IsNullOrEmpty(result.project)||String.IsNullOrEmpty(result.svg))throw new Exception("The editor returned an invalid project snapshot.");
            Json().DeserializeObject(result.project);
            string svgPath=Path.Combine(folder,"preview.svg");
            string exported=TransparentPreview(result.svg),preview=exported;
            if(old!=null) {
                var artwork=new XmlDocument {
                    XmlResolver=null
                }
                ;
                artwork.LoadXml(preview);
                if(artwork.DocumentElement.LocalName!="svg"||!artwork.DocumentElement.HasAttribute("viewBox"))throw new Exception("The SVG has no valid viewBox. The original picture is unchanged.");
                artwork.DocumentElement.SetAttribute("width",((double)old.Width).ToString(System.Globalization.CultureInfo.InvariantCulture)+"pt");
                artwork.DocumentElement.SetAttribute("height",((double)old.Height).ToString(System.Globalization.CultureInfo.InvariantCulture)+"pt");
                artwork.DocumentElement.SetAttribute("preserveAspectRatio","xMidYMid meet");
                preview=artwork.OuterXml;
            }
            File.WriteAllText(svgPath,preview,new UTF8Encoding(false));
            var history=new List<Snapshot>();
            if(prior!=null) {
                history.Add(prior.current);
                if(prior.history!=null)history.AddRange(prior.history);
            }
            var next=new Drawing {
                version=2,id=prior==null?Guid.NewGuid().ToString("N"):prior.id,current=new Snapshot {
                    project=result.project,svg=exported,documentId=result.documentId,time=DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss")
                }
                ,history=history.Take(3).ToList()
            }
            ;
            applicationDynamic.StartNewUndoEntry();
            dynamic picture=slide.Shapes.AddPicture(svgPath,0,-1,0,0,-1,-1);
            try {
                Embed(picture,next);
                picture.LockAspectRatio=-1;
                if(old==null) {
                    float width=(float)slide.Parent.PageSetup.SlideWidth;
                    float height=(float)slide.Parent.PageSetup.SlideHeight;
                    if(picture.Width>width*.75f)picture.Width=width*.75f;
                    if(picture.Height>height*.7f)picture.Height=height*.7f;
                    picture.Left=(width-(float)picture.Width)/2;
                    picture.Top=(height-(float)picture.Height)/2;
                }
                else  {
                    picture.LockAspectRatio=0;
                    picture.Width=old.Width;
                    picture.Height=old.Height;
                    picture.Left=old.Left;
                    picture.Top=old.Top;
                    picture.Rotation=old.Rotation;
                    picture.Name=old.Name;
                    int position=old.ZOrderPosition;
                    while(picture.ZOrderPosition>position)picture.ZOrder(3);
                    picture.LockAspectRatio=-1;
                }
                if(old!=null)old.Delete();
                return picture;
            }
            catch {
                picture.Delete();
                throw;
            }
        }
        void Receive(bool explain) {
            if(session==null) {
                if(explain)MessageBox.Show("Create or edit a circuit first, then choose Save to PowerPoint in the editor.","Circuit Canvas");
                return;
            }
            if(!session.receipt.TryPublish(session.folder))return;
            string path=Path.Combine(session.folder,"result.json");
            if(!File.Exists(path))return;
            Result result;
            try {
                result=Json().Deserialize<Result>(File.ReadAllText(path));
            }
            catch {
                return;
            }
            if(result.sequence<=session.sequence||result.token!=session.token)return;
            // PowerPoint temporarily rejects COM calls while a modal dialog is open. Retry later.
            try {
                dynamic picture=Apply(app,session.slide,session.shape,session.baseline,result,session.folder);
                session.shape=picture;
                session.baseline=ReadPayload(picture);
                session.sequence=result.sequence;
                Ack(result.sequence,true,null);
            }
            catch(COMException e) {
                if(e.ErrorCode==unchecked((int)0x80010001)||e.ErrorCode==unchecked((int)0x8001010A))return;
                session.sequence=result.sequence;
                Ack(result.sequence,false,e.Message);
                if(explain)MessageBox.Show(e.Message,"Circuit Canvas");
            }
            catch(Exception e) {
                session.sequence=result.sequence;
                Ack(result.sequence,false,e.Message);
                if(explain)MessageBox.Show(e.Message,"Circuit Canvas");
            }
        }
        void Ack(int sequence,bool ok,string error) {
            session.receipt.Record(sequence,ok,error);
            session.receipt.TryPublish(session.folder);
        }
    }
}
