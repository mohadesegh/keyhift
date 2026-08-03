using System;
using System.Drawing;
using System.Windows.Forms;

internal static class WindowsShortcutTarget
{
    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        var editor = new TextBox
        {
            Dock = DockStyle.Fill,
            Font = new Font("Segoe UI", 24),
            Multiline = true,
        };
        var form = new Form
        {
            ClientSize = new Size(640, 200),
            StartPosition = FormStartPosition.CenterScreen,
            Text = "KeyShift integration target",
            TopMost = true,
        };

        form.Controls.Add(editor);
        form.Shown += delegate
        {
            form.Activate();
            editor.Focus();
        };

        Application.Run(form);
    }
}
