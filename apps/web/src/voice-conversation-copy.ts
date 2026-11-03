const en = { start: "Start voice conversation", stop: "Stop listening", loading: "Loading local wake model…", requesting: "Allow microphone access…",
  standby: "Waiting for wake word", listening: "Listening · pauses send automatically", transcribing: "Transcribing…", replying: "Replying · listening paused",
  feedback: "Listening paused", failed: "Recognition failed. Retry this recording or stop listening.", conflict: "Draft changed or attachments are present. Review this voice message before sending.",
  engine: "Voice engine unavailable. Check model resources and browser support.", permission: "Microphone permission denied.", unavailable: "Voice resources are not ready. Ask an administrator to prepare and enable the ASR extension.",
  retry: "Retry recording", resume: "Continue listening", insert: "Insert into draft", discard: "Discard", notice: "Voice conversation", paused: "Stop manual recording before starting voice conversation." };
const zh: typeof en = { start: "开启语音对话", stop: "停止语音监听", loading: "正在加载本地唤醒模型…", requesting: "请允许使用麦克风…",
  standby: "等待唤醒词", listening: "正在听 · 停顿后自动发送", transcribing: "正在识别…", replying: "正在回复 · 听写已暂停",
  feedback: "听写已暂停", failed: "识别失败，可重试本段录音或停止监听。", conflict: "草稿已修改或存在附件，请核对这段语音后手动发送。",
  engine: "语音引擎不可用，请检查模型资源和浏览器支持。", permission: "麦克风权限被拒绝。", unavailable: "语音资源未就绪，请管理员准备模型并启用 ASR 扩展。",
  retry: "重试本段录音", resume: "继续听写", insert: "插入草稿", discard: "丢弃", notice: "语音对话", paused: "请先停止手动录音，再开启语音对话。" };
const hk: typeof en = { start: "開啟語音對話", stop: "停止語音監聽", loading: "正在載入本地喚醒模型…", requesting: "請允許使用麥克風…",
  standby: "等待喚醒詞", listening: "正在聽 · 停頓後自動傳送", transcribing: "正在識別…", replying: "正在回覆 · 聽寫已暫停",
  feedback: "聽寫已暫停", failed: "識別失敗，可重試本段錄音或停止監聽。", conflict: "草稿已修改或存在附件，請核對這段語音後手動傳送。",
  engine: "語音引擎無法使用，請檢查模型資源和瀏覽器支援。", permission: "麥克風權限被拒絕。", unavailable: "語音資源未就緒，請管理員準備模型並啟用 ASR 擴充。",
  retry: "重試本段錄音", resume: "繼續聽寫", insert: "插入草稿", discard: "捨棄", notice: "語音對話", paused: "請先停止手動錄音，再開啟語音對話。" };
const ja: typeof en = { start: "音声対話を開始", stop: "音声入力を停止", loading: "起動モデルを読み込み中…", requesting: "マイクの使用を許可してください…",
  standby: "起動語を待っています", listening: "聞き取り中 · 無音後に自動送信", transcribing: "文字起こし中…", replying: "応答中 · 聞き取りは一時停止",
  feedback: "聞き取りを一時停止", failed: "認識に失敗しました。この録音を再試行するか停止してください。", conflict: "下書きが変更されたか添付があります。音声メッセージを確認して送信してください。",
  engine: "音声エンジンを利用できません。モデルとブラウザーの対応を確認してください。", permission: "マイクの使用が拒否されました。", unavailable: "音声リソースが未準備です。管理者に ASR 拡張の準備を依頼してください。",
  retry: "録音を再試行", resume: "聞き取りを続ける", insert: "下書きに挿入", discard: "破棄", notice: "音声対話", paused: "手動録音を停止してから音声対話を開始してください。" };
export function conversationCopy(locale: string): typeof en { return /^zh[-_]HK/i.test(locale) ? hk : /^zh/i.test(locale) ? zh : /^ja/i.test(locale) ? ja : en; }
