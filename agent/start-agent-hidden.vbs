' Launches the Courier agent with no console window.
'
' Node has no windowless executable of its own, so running it straight from a
' Scheduled Task pops a black console window at every login. This shim starts
' it hidden instead. Harmless to run by hand.

Dim shell, fso, here, entry
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

here = fso.GetParentFolderName(WScript.ScriptFullName)
entry = fso.BuildPath(here, "src\index.js")

shell.CurrentDirectory = here
' 0 = hidden window, False = don't wait for it to exit.
shell.Run """node.exe"" """ & entry & """", 0, False
