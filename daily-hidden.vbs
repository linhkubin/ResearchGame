' Chạy quy trình hằng ngày không hiện cửa sổ console (dùng cho Task Scheduler "ChartTracker Daily").
' Lý do: cửa sổ đen của task bị đóng nhầm là quy trình chết giữa chừng (23/11 và 24/11/2026, mã 0xC000013A).
' Task gọi: wscript.exe //B daily-hidden.vbs, thư mục làm việc = chart-tracker. Log vẫn ghi vào data\daily.log.
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
' 0 = ẩn cửa sổ, True = chờ chạy xong để Task Scheduler biết task còn đang chạy
code = sh.Run("cmd.exe /c """"C:\Program Files\nodejs\node.exe"" daily.mjs >> data\daily.log 2>&1""", 0, True)
WScript.Quit code
