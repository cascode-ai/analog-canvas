using System;
using System.IO;
using System.Threading;
using System.Runtime.InteropServices;
using CircuitCanvas;
class VerifyCancellation {
    static void Check(bool condition, string name) {
        if(!condition)throw new Exception(name);
        Console.WriteLine("PASS " + name);
    }
    static string Fixture(string parent) {
        string folder = Path.Combine(parent, Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(folder);
        File.WriteAllText(Path.Combine(folder, "result.json"), "{\"token\":\"test\",\"sequence\":1,\"project\":\"updated drawing\"}");
        return folder;
    }
    static bool Locked(string folder) {
        try {
            using(var gate = new FileStream(Path.Combine(folder, "exchange.lock"), FileMode.CreateNew)) {}
            File.Delete(Path.Combine(folder, "exchange.lock"));
            return false;
        }
        catch(IOException) { return true; }
    }
    static int SelfTest(string parent) {
        string folder = Fixture(parent);
        var receiver = new ResultReceiver(folder, "test");
        int applied = 0;
        receiver.Poll(result => { throw new COMException("Office modal dialog", unchecked((int)0x80010001)); });
        Check(!Locked(folder), "Office rejection releases the gate for cancellation");
        File.WriteAllText(Path.Combine(folder, "cancel.json"), "{\"token\":\"test\",\"throughSequence\":1}");
        receiver.Poll(result => applied++);
        Check(applied == 0, "cancelled save is not applied when Office becomes available");
        new ResultReceiver(folder, "test").Poll(result => applied++);
        Check(applied == 0, "receiver restart retains cancellation");
        folder = Fixture(parent);
        receiver = new ResultReceiver(folder, "test");
        Directory.CreateDirectory(Path.Combine(folder, "ack.json"));
        receiver.Poll(result => {
            Check(Locked(folder), "read result remains protected before and throughout apply");
            receiver.Poll(nested => applied += 100);
            Check(Locked(folder), "reentrant Office callbacks cannot release the active apply gate");
            applied++;
        });
        Check(applied == 1 && Locked(folder), "failed receipt retains the gate and prevents a false cancellation");
        Directory.Delete(Path.Combine(folder, "ack.json"));
        receiver.Poll(result => applied++);
        Check(applied == 1 && !Locked(folder), "receipt recovery does not apply twice and releases the gate");
        Check(File.ReadAllText(Path.Combine(folder, "ack.json")).Contains("\"ok\":true"), "normal save publishes acknowledgement");
        folder = Fixture(parent);
        File.WriteAllText(Path.Combine(folder, "cancel.json"), "invalid");
        new ResultReceiver(folder, "test").Poll(result => applied++);
        Check(applied == 1, "malformed cancellation fails closed");
        File.WriteAllText(Path.Combine(folder, "cancel.json"), "{\"token\":\"other\"}");
        new ResultReceiver(folder, "test").Poll(result => applied++);
        Check(applied == 2, "cancellation is scoped to its session token");
        return 0;
    }
    static int Main(string[] args) {
        if(args[0] == "--self-test")return SelfTest(Path.GetFullPath(args[1]));
        var receiver = new ResultReceiver(Path.GetFullPath(args[0]), "test");
        string error = receiver.Poll(result => {
            File.WriteAllText(Path.Combine(args[0], "receiver-ready"), "read; applying under the exchange lock");
            while(File.Exists(Path.Combine(args[0], "block-apply")))Thread.Sleep(20);
            File.WriteAllText(Path.Combine(args[0], "applied.json"), result.project);
        });
        if(error != null) { Console.Error.WriteLine(error); return 1; }
        return 0;
    }
}
