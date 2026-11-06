using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;

namespace CircuitCanvas {
    // The lease covers reading, applying, and publishing the receipt. Cancellation
    // uses the same exclusive-create gate in the desktop host. Never steal a lock:
    // after a crash an interrupted Office operation has an unknown outcome.
    public sealed class ResultReceiver {
        readonly string folder, token;
        readonly SaveReceipt receipt = new SaveReceipt();
        FileStream lease;
        int sequence;
        bool polling;

        public ResultReceiver(string folder, string token) {
            this.folder = folder;
            this.token = token;
        }

        void Release() {
            lease.Dispose();
            lease = null;
            File.Delete(Path.Combine(folder, "exchange.lock"));
        }

        public string Poll(Action<Result> apply) {
            // Office STA calls may pump timer callbacks while apply is running.
            // A live lease is not necessarily an outstanding receipt.
            if(polling)return null;
            polling = true;
            try { return PollCore(apply); }
            finally { polling = false; }
        }

        string PollCore(Action<Result> apply) {
            if(lease != null) {
                if(!receipt.TryPublish(folder))return null;
                Release();
            }
            try {
                lease = new FileStream(Path.Combine(folder, "exchange.lock"), FileMode.CreateNew, FileAccess.Write, FileShare.None);
            }
            catch(IOException) { return null; }
            catch(UnauthorizedAccessException) { return null; }
            bool retain = false;
            try {
                var json = new JavaScriptSerializer { MaxJsonLength = 64 * 1024 * 1024, RecursionLimit = 200 };
                string cancel = Path.Combine(folder, "cancel.json");
                if(File.Exists(cancel)) {
                    var cancelled = json.Deserialize<System.Collections.Generic.Dictionary<string, object>>(File.ReadAllText(cancel));
                    if((string)cancelled["token"] == token)return null;
                }
                string path = Path.Combine(folder, "result.json");
                if(!File.Exists(path))return null;
                var result = json.Deserialize<Result>(File.ReadAllText(path));
                if(result == null || result.token != token || result.sequence <= sequence)return null;
                string error = null;
                try { apply(result); }
                catch(COMException e) {
                    // Modal dialogs temporarily reject Office calls. Release the
                    // gate so cancellation can win before the next timer retry.
                    if(e.ErrorCode == unchecked((int)0x80010001) || e.ErrorCode == unchecked((int)0x8001010A))return null;
                    error = e.Message;
                }
                catch(Exception e) { error = e.Message; }
                sequence = result.sequence;
                receipt.Record(sequence, error == null, error);
                retain = !receipt.TryPublish(folder);
                return error;
            }
            catch(Exception e) { return e.Message; }
            finally {
                // If applying succeeded but the receipt could not be published,
                // cancellation must not report that this update was discarded.
                if(!retain)Release();
            }
        }
    }
}
