const en = {
  start: "Voice input", stop: "Stop and transcribe", cancel: "Cancel", insert: "Insert text", discard: "Discard",
  requesting: "Allow microphone access…", recording: "Recording", converting: "Preparing audio…", transcribing: "Transcribing…",
  unavailable: "Microphone unavailable. Use HTTPS or localhost and check your input device.",
  permission: "Microphone access was denied. Allow access in browser settings.", empty: "No speech detected. Try recording again.",
  interrupted: "Microphone disconnected or recording interrupted. Please try again.",
  cancelled: "Recording cancelled.", tooLarge: "Recording exceeds the audio limit.",
  failed: "Transcription failed. Check the recognition model in your personal settings and try again.",
  conflict: "The draft changed. Review the transcript and insert it when ready.", level: "Microphone level", speechFailed: "Speech generation failed. Check your model settings.",
};
const zh: typeof en = {
  start: "语音输入", stop: "停止并转写", cancel: "取消", insert: "插入文字", discard: "丢弃",
  requesting: "请允许访问麦克风…", recording: "录音中", converting: "正在处理录音…", transcribing: "正在识别…",
  unavailable: "麦克风不可用，请使用 HTTPS 或 localhost，并检查输入设备。", permission: "麦克风权限被拒绝，请在浏览器设置中允许访问。",
  empty: "未检测到语音，请重新录音。", interrupted: "麦克风已断开或录音中断，请重试。", cancelled: "录音已取消。",
  tooLarge: "录音超过大小限制。", failed: "语音识别失败，请检查个人设置中的识别模型后重试。",
  conflict: "草稿已修改，请核对识别结果后手动插入。", level: "麦克风音量", speechFailed: "语音合成失败，请检查个人模型配置。",
};
const hk: typeof en = {
  start: "語音輸入", stop: "停止並轉寫", cancel: "取消", insert: "插入文字", discard: "捨棄",
  requesting: "請允許存取麥克風…", recording: "錄音中", converting: "正在處理錄音…", transcribing: "正在識別…",
  unavailable: "麥克風不可用，請使用 HTTPS 或 localhost，並檢查輸入裝置。", permission: "麥克風權限被拒絕，請在瀏覽器設定中允許存取。",
  empty: "未偵測到語音，請重新錄音。", interrupted: "麥克風已中斷或錄音停止，請重試。", cancelled: "錄音已取消。",
  tooLarge: "錄音超過大小限制。", failed: "語音識別失敗，請檢查個人設定中的識別模型後重試。",
  conflict: "草稿已修改，請核對識別結果後手動插入。", level: "麥克風音量", speechFailed: "語音合成失敗，請檢查個人模型設定。",
};
const ja: typeof en = {
  start: "音声入力", stop: "停止して文字起こし", cancel: "キャンセル", insert: "テキストを挿入", discard: "破棄",
  requesting: "マイクへのアクセスを許可してください…", recording: "録音中", converting: "音声を準備中…", transcribing: "文字起こし中…",
  unavailable: "マイクを使用できません。HTTPS または localhost を使用し、入力デバイスを確認してください。",
  permission: "マイクへのアクセスが拒否されました。ブラウザーの設定で許可してください。", empty: "音声が検出されませんでした。もう一度録音してください。",
  interrupted: "マイクの切断または録音の中断が発生しました。再試行してください。", cancelled: "録音をキャンセルしました。",
  tooLarge: "録音がサイズ制限を超えています。", failed: "文字起こしに失敗しました。個人設定の認識モデルを確認してください。",
  conflict: "下書きが変更されました。認識結果を確認して挿入してください。", level: "マイクの音量", speechFailed: "音声合成に失敗しました。モデル設定を確認してください。",
};
export function voiceCopy(locale: string): typeof en {
  if (/^zh[-_]HK/i.test(locale)) return hk;
  if (/^zh/i.test(locale)) return zh;
  if (/^ja/i.test(locale)) return ja;
  return en;
}
