using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

public sealed class KeyShiftConfig
{
    public string shortcut { get; set; }

    public string layoutMode { get; set; }
    public string sourceLayout { get; set; }
    public string targetLayout { get; set; }
    public string directionDetection { get; set; }

    public bool preserveClipboard { get; set; }
    public int copyDelayMs { get; set; }
    public int pasteDelayMs { get; set; }
    public bool selectAllText { get; set; }
}

public sealed class KeyboardLayoutInfo
{
    public IntPtr Handle { get; set; }
    public string Id { get; set; }
    public string Name { get; set; }
    public int LanguageId { get; set; }
    public bool IsRightToLeft { get; set; }
}

public sealed class ConversionDirection
{
    public KeyboardLayoutInfo Source { get; set; }
    public KeyboardLayoutInfo Target { get; set; }
}

public sealed class HotkeyForm : Form
{
    private const int WH_KEYBOARD_LL = 13;

    private const int WM_KEYDOWN = 0x0100;
    private const int WM_KEYUP = 0x0101;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int WM_SYSKEYUP = 0x0105;

    private const int VK_CONTROL = 0x11;
    private const int VK_SHIFT = 0x10;
    private const int VK_MENU = 0x12;

    private const int VK_LWIN = 0x5B;
    private const int VK_RWIN = 0x5C;

    private const int VK_A = 0x41;
    private const int VK_C = 0x43;
    private const int VK_V = 0x56;
    private const int VK_END = 0x23;
    private const int VK_RIGHT = 0x27;

    private const uint INPUT_KEYBOARD = 1;
    private const uint KEYEVENTF_KEYUP = 0x0002;

    private const uint MAPVK_VK_TO_VSC = 0;

    private readonly string _configPath;
    private readonly string _logPath;

    private IntPtr _keyboardHook;
    private LowLevelKeyboardProc _keyboardProc;

    private int _shortcutKey;

    private bool _needControl;
    private bool _needAlt;
    private bool _needShift;
    private bool _needWin;

    private bool _shortcutWasDown;

    private bool _controlDown;
    private bool _altDown;
    private bool _shiftDown;
    private bool _winDown;

    private int _operationRunning;

    private delegate IntPtr LowLevelKeyboardProc(
        int code,
        IntPtr wParam,
        IntPtr lParam
    );

    [StructLayout(LayoutKind.Sequential)]
    private struct KBDLLHOOKSTRUCT
    {
        public uint vkCode;
        public uint scanCode;
        public uint flags;
        public uint time;
        public IntPtr extraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT
    {
        public uint type;
        public InputUnion U;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion
    {
        [FieldOffset(0)]
        public MOUSEINPUT mouse;

        [FieldOffset(0)]
        public KEYBDINPUT keyboard;

        [FieldOffset(0)]
        public HARDWAREINPUT hardware;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MOUSEINPUT
    {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint flags;
        public uint time;
        public IntPtr extraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KEYBDINPUT
    {
        public ushort virtualKey;
        public ushort scanCode;
        public uint flags;
        public uint time;
        public IntPtr extraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct HARDWAREINPUT
    {
        public uint message;
        public ushort parameterLow;
        public ushort parameterHigh;
    }

    [DllImport(
        "user32.dll",
        SetLastError = true
    )]
    private static extern IntPtr SetWindowsHookEx(
        int hookId,
        LowLevelKeyboardProc callback,
        IntPtr moduleHandle,
        uint threadId
    );

    [DllImport(
        "user32.dll",
        SetLastError = true
    )]
    private static extern bool UnhookWindowsHookEx(
        IntPtr hook
    );

    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(
        IntPtr hook,
        int code,
        IntPtr wParam,
        IntPtr lParam
    );

    [DllImport(
        "kernel32.dll",
        CharSet = CharSet.Auto,
        SetLastError = true
    )]
    private static extern IntPtr GetModuleHandle(
        string moduleName
    );

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(
        int virtualKey
    );

    [DllImport(
        "user32.dll",
        SetLastError = true
    )]
    private static extern uint SendInput(
        uint count,
        INPUT[] inputs,
        int size
    );

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(
        IntPtr windowHandle,
        IntPtr processId
    );

    [DllImport("user32.dll")]
    private static extern IntPtr GetKeyboardLayout(
        uint threadId
    );

    [DllImport("user32.dll")]
    private static extern int GetKeyboardLayoutList(
        int bufferCount,
        [Out] IntPtr[] layoutHandles
    );

    [DllImport(
        "user32.dll",
        CharSet = CharSet.Unicode,
        SetLastError = true
    )]
    private static extern IntPtr LoadKeyboardLayout(
        string layoutId,
        uint flags
    );

    [DllImport(
        "user32.dll",
        CharSet = CharSet.Unicode
    )]
    private static extern short VkKeyScanEx(
        char character,
        IntPtr keyboardLayout
    );

    [DllImport("user32.dll")]
    private static extern uint MapVirtualKeyEx(
        uint code,
        uint mapType,
        IntPtr keyboardLayout
    );

    [DllImport(
        "user32.dll",
        CharSet = CharSet.Unicode
    )]
    private static extern int ToUnicodeEx(
        uint virtualKey,
        uint scanCode,
        byte[] keyboardState,
        [Out] StringBuilder output,
        int outputCapacity,
        uint flags,
        IntPtr keyboardLayout
    );

    public HotkeyForm(
        string configPath,
        string logPath
    )
    {
        _configPath = configPath;
        _logPath = logPath;

        _keyboardHook = IntPtr.Zero;

        ShowInTaskbar = false;
        WindowState = FormWindowState.Minimized;
        FormBorderStyle = FormBorderStyle.FixedToolWindow;
        Opacity = 0;

        Load += OnLoad;
        FormClosing += OnClosing;
    }

    private void OnLoad(
        object sender,
        EventArgs eventArgs
    )
    {
        KeyShiftConfig config = LoadConfig();

        ParseShortcut(config.shortcut);

        _keyboardProc = KeyboardHookCallback;

        using (
            Process currentProcess =
                Process.GetCurrentProcess()
        )
        using (
            ProcessModule currentModule =
                currentProcess.MainModule
        )
        {
            string moduleName =
                currentModule != null
                    ? currentModule.ModuleName
                    : null;

            IntPtr moduleHandle =
                GetModuleHandle(moduleName);

            _keyboardHook = SetWindowsHookEx(
                WH_KEYBOARD_LL,
                _keyboardProc,
                moduleHandle,
                0
            );
        }

        if (_keyboardHook == IntPtr.Zero)
        {
            throw new InvalidOperationException(
                "SetWindowsHookEx failed. Win32 error: " +
                Marshal.GetLastWin32Error()
            );
        }

        Log(
            "KeyShift host running. Shortcut=" +
            config.shortcut
        );

        Log(
            "Layouts=" +
            config.sourceLayout +
            " <-> " +
            config.targetLayout
        );

        Log(
            "LayoutMode=" +
            config.layoutMode +
            ", DirectionDetection=" +
            config.directionDetection
        );
    }

    private void OnClosing(
        object sender,
        FormClosingEventArgs eventArgs
    )
    {
        if (_keyboardHook != IntPtr.Zero)
        {
            UnhookWindowsHookEx(_keyboardHook);
            _keyboardHook = IntPtr.Zero;
        }

        Log("KeyShift host stopped.");
    }

    private IntPtr KeyboardHookCallback(
        int code,
        IntPtr wParam,
        IntPtr lParam
    )
    {
        if (code >= 0)
        {
            int message = wParam.ToInt32();

            KBDLLHOOKSTRUCT data =
                (KBDLLHOOKSTRUCT)
                Marshal.PtrToStructure(
                    lParam,
                    typeof(KBDLLHOOKSTRUCT)
                );

            int key =
                unchecked((int)data.vkCode);

            bool isDownMessage =
                message == WM_KEYDOWN ||
                message == WM_SYSKEYDOWN;

            bool isUpMessage =
                message == WM_KEYUP ||
                message == WM_SYSKEYUP;

            UpdateModifierState(
                key,
                isDownMessage,
                isUpMessage
            );

            if (key == _shortcutKey)
            {
                if (
                    isDownMessage &&
                    !_shortcutWasDown
                )
                {
                    if (ModifiersMatch())
                    {
                        _shortcutWasDown = true;

                        if (
                            Interlocked.CompareExchange(
                                ref _operationRunning,
                                1,
                                0
                            ) != 0
                        )
                        {
                            Log(
                                "Shortcut ignored because conversion is already running."
                            );

                            return CallNextHookEx(
                                _keyboardHook,
                                code,
                                wParam,
                                lParam
                            );
                        }

                        ThreadPool.QueueUserWorkItem(
                            delegate
                            {
                                ExecuteConversion();
                            }
                        );
                    }
                }
                else if (isUpMessage)
                {
                    _shortcutWasDown = false;
                }
            }
        }

        return CallNextHookEx(
            _keyboardHook,
            code,
            wParam,
            lParam
        );
    }

    private void ExecuteConversion()
    {
        try
        {
            WaitForPhysicalModifierRelease();

            BeginInvoke(
                (Action)delegate
                {
                    try
                    {
                        ConvertFocusedText();
                    }
                    catch (Exception exception)
                    {
                        Log(
                            "Conversion error: " +
                            exception
                        );
                    }
                    finally
                    {
                        Interlocked.Exchange(
                            ref _operationRunning,
                            0
                        );
                    }
                }
            );
        }
        catch (Exception exception)
        {
            Log(
                "Conversion error: " +
                exception
            );

            Interlocked.Exchange(
                ref _operationRunning,
                0
            );
        }
    }

    private void UpdateModifierState(
        int key,
        bool isDown,
        bool isUp
    )
    {
        if (
            key == VK_CONTROL ||
            key == 0xA2 ||
            key == 0xA3
        )
        {
            _controlDown =
                isDown
                    ? true
                    : isUp
                        ? false
                        : _controlDown;
        }

        if (
            key == VK_MENU ||
            key == 0xA4 ||
            key == 0xA5
        )
        {
            _altDown =
                isDown
                    ? true
                    : isUp
                        ? false
                        : _altDown;
        }

        if (
            key == VK_SHIFT ||
            key == 0xA0 ||
            key == 0xA1
        )
        {
            _shiftDown =
                isDown
                    ? true
                    : isUp
                        ? false
                        : _shiftDown;
        }

        if (
            key == VK_LWIN ||
            key == VK_RWIN
        )
        {
            _winDown =
                isDown
                    ? true
                    : isUp
                        ? false
                        : _winDown;
        }
    }

    private bool ModifiersMatch()
    {
        return
            (!_needControl || _controlDown) &&
            (!_needAlt || _altDown) &&
            (!_needShift || _shiftDown) &&
            (!_needWin || _winDown);
    }

    private KeyShiftConfig LoadConfig()
    {
        JavaScriptSerializer serializer =
            new JavaScriptSerializer();

        string raw = File.ReadAllText(
            _configPath,
            Encoding.UTF8
        );

        int jsonStart = raw.IndexOf('{');

        if (jsonStart < 0)
        {
            throw new InvalidOperationException(
                "Invalid KeyShift configuration."
            );
        }

        KeyShiftConfig config =
            serializer.Deserialize<KeyShiftConfig>(
                raw.Substring(jsonStart)
            );

        if (config == null)
        {
            throw new InvalidOperationException(
                "Unable to deserialize KeyShift configuration."
            );
        }

        if (
            String.IsNullOrWhiteSpace(
                config.layoutMode
            )
        )
        {
            config.layoutMode = "auto";
        }

        if (
            String.IsNullOrWhiteSpace(
                config.directionDetection
            )
        )
        {
            config.directionDetection = "hybrid";
        }

        return config;
    }

    private void ConvertFocusedText()
    {
        KeyShiftConfig config = LoadConfig();

        IntPtr activeLayout =
            GetForegroundKeyboardLayout();

        string previousClipboardText = null;
        bool restoreClipboard = false;

        if (config.preserveClipboard)
        {
            try
            {
                previousClipboardText =
                    GetClipboardTextWithRetry();

                restoreClipboard =
                    previousClipboardText != null;
            }
            catch (Exception exception)
            {
                Log(
                    "Clipboard preservation skipped: " +
                    exception.Message
                );
            }
        }

        ClearClipboardWithRetry();

        if (config.selectAllText)
        {
            Log(
                "Selecting all text in focused control."
            );

            SendCtrlCombo(VK_A);

            Application.DoEvents();
            Thread.Sleep(120);
        }

        Log("Sending Ctrl+C.");

        SendCtrlCombo(VK_C);
        Application.DoEvents();

        string selectedText =
            WaitForClipboardText(
                Math.Max(
                    config.copyDelayMs,
                    3000
                )
            );

        if (String.IsNullOrEmpty(selectedText))
        {
            if (config.selectAllText)
            {
                SendSingleKey(VK_RIGHT);
            }

            Application.DoEvents();

            Log(
                "Hotkey fired, but no editable or selected text was copied."
            );

            RestoreClipboardIfNeeded(
                restoreClipboard,
                previousClipboardText
            );

            return;
        }

        KeyboardLayoutInfo firstLayout =
            ResolveLayout(
                config.sourceLayout
            );

        KeyboardLayoutInfo secondLayout =
            ResolveLayout(
                config.targetLayout
            );

        ConversionDirection direction =
            DetermineDirection(
                selectedText,
                firstLayout,
                secondLayout,
                activeLayout,
                config
            );

        Log(
            "Converting from " +
            direction.Source.Id +
            " (" +
            direction.Source.Name +
            ") to " +
            direction.Target.Id +
            " (" +
            direction.Target.Name +
            ")."
        );

        string convertedText =
            ConvertTextBetweenLayouts(
                selectedText,
                direction.Source,
                direction.Target
            );

        if (
            String.IsNullOrEmpty(convertedText) ||
            convertedText == selectedText
        )
        {
            Log(
                "Converted text was unchanged."
            );

            RestoreClipboardIfNeeded(
                restoreClipboard,
                previousClipboardText
            );

            return;
        }

        SetClipboardTextWithRetry(
            convertedText
        );

        Thread.Sleep(
            Math.Max(
                config.pasteDelayMs,
                120
            )
        );

        Log("Sending Ctrl+V.");

        SendCtrlCombo(VK_V);

        Application.DoEvents();

        Thread.Sleep(
            Math.Max(
                config.pasteDelayMs,
                250
            )
        );

        if (config.selectAllText)
        {
            SendSingleKey(VK_END);
            Application.DoEvents();
        }

        RestoreClipboardIfNeeded(
            restoreClipboard,
            previousClipboardText
        );

        Log(
            "Converted focused text successfully. " +
            "InputLength=" +
            selectedText.Length +
            ", OutputLength=" +
            convertedText.Length
        );
    }

    private ConversionDirection DetermineDirection(
        string text,
        KeyboardLayoutInfo first,
        KeyboardLayoutInfo second,
        IntPtr activeLayout,
        KeyShiftConfig config
    )
    {
        string mode =
            (config.layoutMode ?? "auto")
                .Trim()
                .ToLowerInvariant();

        if (mode == "pair")
        {
            return CreateDirection(
                first,
                second
            );
        }

        string detection =
            (
                config.directionDetection ??
                "hybrid"
            )
            .Trim()
            .ToLowerInvariant();

        bool activeIsFirst =
            LayoutHandlesMatch(
                activeLayout,
                first.Handle
            );

        bool activeIsSecond =
            LayoutHandlesMatch(
                activeLayout,
                second.Handle
            );

        if (detection == "active-layout")
        {
            if (activeIsSecond)
            {
                return CreateDirection(
                    second,
                    first
                );
            }

            return CreateDirection(
                first,
                second
            );
        }

        int latinCount = 0;
        int rtlCount = 0;

        CountScriptCharacters(
            text,
            out latinCount,
            out rtlCount
        );

        if (rtlCount > latinCount)
        {
            if (
                first.IsRightToLeft &&
                !second.IsRightToLeft
            )
            {
                return CreateDirection(
                    first,
                    second
                );
            }

            if (
                second.IsRightToLeft &&
                !first.IsRightToLeft
            )
            {
                return CreateDirection(
                    second,
                    first
                );
            }
        }

        if (latinCount > rtlCount)
        {
            if (
                !first.IsRightToLeft &&
                second.IsRightToLeft
            )
            {
                return CreateDirection(
                    first,
                    second
                );
            }

            if (
                !second.IsRightToLeft &&
                first.IsRightToLeft
            )
            {
                return CreateDirection(
                    second,
                    first
                );
            }
        }

        int firstScore =
            CountConvertibleCharacters(
                text,
                first.Handle
            );

        int secondScore =
            CountConvertibleCharacters(
                text,
                second.Handle
            );

        if (firstScore > secondScore)
        {
            return CreateDirection(
                first,
                second
            );
        }

        if (secondScore > firstScore)
        {
            return CreateDirection(
                second,
                first
            );
        }

        if (detection == "content")
        {
            return CreateDirection(
                first,
                second
            );
        }

        if (activeIsSecond)
        {
            return CreateDirection(
                second,
                first
            );
        }

        if (activeIsFirst)
        {
            return CreateDirection(
                first,
                second
            );
        }

        return CreateDirection(
            first,
            second
        );
    }

    private static ConversionDirection CreateDirection(
        KeyboardLayoutInfo source,
        KeyboardLayoutInfo target
    )
    {
        ConversionDirection result =
            new ConversionDirection();

        result.Source = source;
        result.Target = target;

        return result;
    }

    private static void CountScriptCharacters(
        string text,
        out int latinCount,
        out int rtlCount
    )
    {
        latinCount = 0;
        rtlCount = 0;

        foreach (char character in text)
        {
            if (
                character >= '\u0041' &&
                character <= '\u007A'
            )
            {
                latinCount++;
                continue;
            }

            if (
                (
                    character >= '\u0600' &&
                    character <= '\u06FF'
                ) ||
                (
                    character >= '\u0750' &&
                    character <= '\u077F'
                ) ||
                (
                    character >= '\u08A0' &&
                    character <= '\u08FF'
                )
            )
            {
                rtlCount++;
            }
        }
    }

    private static int CountConvertibleCharacters(
        string text,
        IntPtr sourceLayout
    )
    {
        int score = 0;

        foreach (char character in text)
        {
            if (Char.IsWhiteSpace(character))
            {
                continue;
            }

            short keyResult =
                VkKeyScanEx(
                    character,
                    sourceLayout
                );

            if (keyResult != -1)
            {
                score++;
            }
        }

        return score;
    }

    private string ConvertTextBetweenLayouts(
        string input,
        KeyboardLayoutInfo source,
        KeyboardLayoutInfo target
    )
    {
        StringBuilder result =
            new StringBuilder();

        foreach (char character in input)
        {
            string converted =
                ConvertCharacter(
                    character,
                    source.Handle,
                    target.Handle
                );

            result.Append(
                converted ?? character.ToString()
            );
        }

        return result.ToString();
    }

    private string ConvertCharacter(
        char character,
        IntPtr sourceLayout,
        IntPtr targetLayout
    )
    {
        if (
            character == '\r' ||
            character == '\n' ||
            character == '\t'
        )
        {
            return character.ToString();
        }

        short keyResult =
            VkKeyScanEx(
                character,
                sourceLayout
            );

        if (keyResult == -1)
        {
            return character.ToString();
        }

        int virtualKey =
            keyResult & 0xFF;

        int modifierState =
            (keyResult >> 8) & 0xFF;

        byte[] keyboardState =
            new byte[256];

        if ((modifierState & 1) != 0)
        {
            keyboardState[VK_SHIFT] = 0x80;
        }

        if ((modifierState & 2) != 0)
        {
            keyboardState[VK_CONTROL] = 0x80;
        }

        if ((modifierState & 4) != 0)
        {
            keyboardState[VK_MENU] = 0x80;
        }

        uint scanCode =
            MapVirtualKeyEx(
                (uint)virtualKey,
                MAPVK_VK_TO_VSC,
                targetLayout
            );

        StringBuilder output =
            new StringBuilder(16);

        int characterCount =
            ToUnicodeEx(
                (uint)virtualKey,
                scanCode,
                keyboardState,
                output,
                output.Capacity,
                0,
                targetLayout
            );

        if (characterCount > 0)
        {
            string value = output.ToString();

            if (
                value.Length > characterCount
            )
            {
                value = value.Substring(
                    0,
                    characterCount
                );
            }

            return value;
        }

        if (characterCount < 0)
        {
            ClearDeadKeyState(
                virtualKey,
                scanCode,
                keyboardState,
                targetLayout
            );

            string deadKeyResult =
                output.ToString();

            if (
                !String.IsNullOrEmpty(
                    deadKeyResult
                )
            )
            {
                return deadKeyResult.Substring(
                    0,
                    1
                );
            }
        }

        return character.ToString();
    }

    private static void ClearDeadKeyState(
        int virtualKey,
        uint scanCode,
        byte[] keyboardState,
        IntPtr keyboardLayout
    )
    {
        StringBuilder buffer =
            new StringBuilder(16);

        for (int index = 0; index < 5; index++)
        {
            int result =
                ToUnicodeEx(
                    (uint)virtualKey,
                    scanCode,
                    keyboardState,
                    buffer,
                    buffer.Capacity,
                    0,
                    keyboardLayout
                );

            if (result >= 0)
            {
                break;
            }
        }
    }

    private static KeyboardLayoutInfo ResolveLayout(
        string configuredId
    )
    {
        string normalizedId =
            NormalizeLayoutId(configuredId);

        List<KeyboardLayoutInfo> installed =
            GetInstalledLayouts();

        foreach (
            KeyboardLayoutInfo layout
            in installed
        )
        {
            if (
                String.Equals(
                    layout.Id,
                    normalizedId,
                    StringComparison.OrdinalIgnoreCase
                )
            )
            {
                return layout;
            }

            if (
                layout.Id.EndsWith(
                    normalizedId.Substring(
                        normalizedId.Length - 4
                    ),
                    StringComparison.OrdinalIgnoreCase
                )
            )
            {
                return layout;
            }
        }

        IntPtr loadedLayout =
            LoadKeyboardLayout(
                normalizedId,
                0
            );

        if (loadedLayout == IntPtr.Zero)
        {
            throw new InvalidOperationException(
                "Keyboard layout is not installed or could not be loaded: " +
                normalizedId
            );
        }

        return CreateLayoutInfo(
            loadedLayout
        );
    }

    public static List<KeyboardLayoutInfo>
        GetInstalledLayouts()
    {
        int count =
            GetKeyboardLayoutList(
                0,
                null
            );

        List<KeyboardLayoutInfo> result =
            new List<KeyboardLayoutInfo>();

        if (count <= 0)
        {
            return result;
        }

        IntPtr[] handles =
            new IntPtr[count];

        int actualCount =
            GetKeyboardLayoutList(
                handles.Length,
                handles
            );

        for (
            int index = 0;
            index < actualCount;
            index++
        )
        {
            KeyboardLayoutInfo info =
                CreateLayoutInfo(
                    handles[index]
                );

            bool duplicate = false;

            foreach (
                KeyboardLayoutInfo existing
                in result
            )
            {
                if (
                    String.Equals(
                        existing.Id,
                        info.Id,
                        StringComparison.OrdinalIgnoreCase
                    )
                )
                {
                    duplicate = true;
                    break;
                }
            }

            if (!duplicate)
            {
                result.Add(info);
            }
        }

        return result;
    }

    private static KeyboardLayoutInfo CreateLayoutInfo(
        IntPtr handle
    )
    {
        long rawValue =
            handle.ToInt64();

        uint lowValue =
            unchecked((uint)rawValue);

        string id =
            lowValue.ToString("X8");

        int languageId =
            unchecked((ushort)lowValue);

        string name =
            "Unknown layout";

        bool isRightToLeft = false;

        try
        {
            CultureInfo culture =
                CultureInfo.GetCultureInfo(
                    languageId
                );

            name = culture.DisplayName;

            isRightToLeft =
                culture.TextInfo.IsRightToLeft;
        }
        catch
        {
            name = "Windows layout " + id;
        }

        KeyboardLayoutInfo result =
            new KeyboardLayoutInfo();

        result.Handle = handle;
        result.Id = id;
        result.Name = name;
        result.LanguageId = languageId;
        result.IsRightToLeft = isRightToLeft;

        return result;
    }

    private static string NormalizeLayoutId(
        string layoutId
    )
    {
        if (
            String.IsNullOrWhiteSpace(
                layoutId
            )
        )
        {
            throw new InvalidOperationException(
                "Keyboard layout ID cannot be empty."
            );
        }

        string normalized =
            layoutId
                .Trim()
                .ToUpperInvariant();

        if (
            normalized.StartsWith(
                "0X",
                StringComparison.OrdinalIgnoreCase
            )
        )
        {
            normalized =
                normalized.Substring(2);
        }

        uint parsed;

        if (
            !UInt32.TryParse(
                normalized,
                NumberStyles.HexNumber,
                CultureInfo.InvariantCulture,
                out parsed
            )
        )
        {
            throw new InvalidOperationException(
                "Invalid keyboard layout ID: " +
                layoutId
            );
        }

        return parsed.ToString("X8");
    }

    private static bool LayoutHandlesMatch(
        IntPtr first,
        IntPtr second
    )
    {
        uint firstValue =
            unchecked(
                (uint)first.ToInt64()
            );

        uint secondValue =
            unchecked(
                (uint)second.ToInt64()
            );

        return firstValue == secondValue;
    }

    private static IntPtr
        GetForegroundKeyboardLayout()
    {
        IntPtr foregroundWindow =
            GetForegroundWindow();

        if (
            foregroundWindow ==
            IntPtr.Zero
        )
        {
            return GetKeyboardLayout(0);
        }

        uint threadId =
            GetWindowThreadProcessId(
                foregroundWindow,
                IntPtr.Zero
            );

        return GetKeyboardLayout(
            threadId
        );
    }

    private void WaitForPhysicalModifierRelease()
    {
        const int timeoutMs = 5000;
        const int pollMs = 20;

        int elapsed = 0;

        while (
            IsDown(VK_CONTROL) ||
            IsDown(VK_MENU) ||
            IsDown(VK_SHIFT) ||
            IsDown(VK_LWIN) ||
            IsDown(VK_RWIN) ||
            IsDown(_shortcutKey)
        )
        {
            if (elapsed >= timeoutMs)
            {
                throw new TimeoutException(
                    "Modifier keys were not released."
                );
            }

            Thread.Sleep(pollMs);
            elapsed += pollMs;
        }

        _controlDown = false;
        _altDown = false;
        _shiftDown = false;
        _winDown = false;
        _shortcutWasDown = false;

        Thread.Sleep(80);
    }

    private string WaitForClipboardText(
        int timeoutMs
    )
    {
        const int intervalMs = 50;

        int elapsed = 0;

        while (elapsed < timeoutMs)
        {
            try
            {
                if (
                    Clipboard.ContainsText(
                        TextDataFormat.UnicodeText
                    )
                )
                {
                    string value =
                        Clipboard.GetText(
                            TextDataFormat.UnicodeText
                        );

                    if (
                        !String.IsNullOrEmpty(
                            value
                        )
                    )
                    {
                        return value;
                    }
                }
            }
            catch (ExternalException)
            {
                // Clipboard may temporarily be locked.
            }

            Application.DoEvents();
            Thread.Sleep(intervalMs);

            elapsed += intervalMs;
        }

        return String.Empty;
    }

    private string GetClipboardTextWithRetry()
    {
        Exception lastError = null;

        for (
            int attempt = 0;
            attempt < 20;
            attempt++
        )
        {
            try
            {
                if (
                    Clipboard.ContainsText(
                        TextDataFormat.UnicodeText
                    )
                )
                {
                    return Clipboard.GetText(
                        TextDataFormat.UnicodeText
                    );
                }

                return null;
            }
            catch (ExternalException exception)
            {
                lastError = exception;
                Thread.Sleep(50);
            }
        }

        throw new ExternalException(
            "Clipboard remained unavailable after retries.",
            lastError
        );
    }

    private void ClearClipboardWithRetry()
    {
        Exception lastError = null;

        for (
            int attempt = 0;
            attempt < 30;
            attempt++
        )
        {
            try
            {
                Clipboard.Clear();
                return;
            }
            catch (ExternalException exception)
            {
                lastError = exception;
                Thread.Sleep(50);
            }
        }

        throw new ExternalException(
            "Could not clear Clipboard after retries.",
            lastError
        );
    }

    private void SetClipboardTextWithRetry(
        string value
    )
    {
        Exception lastError = null;

        for (
            int attempt = 0;
            attempt < 20;
            attempt++
        )
        {
            try
            {
                Clipboard.SetText(
                    value,
                    TextDataFormat.UnicodeText
                );

                return;
            }
            catch (ExternalException exception)
            {
                lastError = exception;
                Thread.Sleep(50);
            }
        }

        throw new ExternalException(
            "Could not write text to Clipboard after retries.",
            lastError
        );
    }

    private void RestoreClipboardIfNeeded(
        bool shouldRestore,
        string previousClipboardText
    )
    {
        if (!shouldRestore)
        {
            return;
        }

        try
        {
            Thread.Sleep(200);

            SetClipboardTextWithRetry(
                previousClipboardText ?? String.Empty
            );

            Log("Clipboard restored.");
        }
        catch (Exception exception)
        {
            Log(
                "Clipboard restore failed: " +
                exception.Message
            );
        }
    }

    private static bool IsDown(int key)
    {
        return (
            GetAsyncKeyState(key) &
            0x8000
        ) != 0;
    }

    private static void SendCtrlCombo(
        int key
    )
    {
        INPUT[] inputs =
            new INPUT[4];

        inputs[0].type = INPUT_KEYBOARD;
        inputs[0].U.keyboard.virtualKey =
            VK_CONTROL;

        inputs[1].type = INPUT_KEYBOARD;
        inputs[1].U.keyboard.virtualKey =
            (ushort)key;

        inputs[2].type = INPUT_KEYBOARD;
        inputs[2].U.keyboard.virtualKey =
            (ushort)key;

        inputs[2].U.keyboard.flags =
            KEYEVENTF_KEYUP;

        inputs[3].type = INPUT_KEYBOARD;
        inputs[3].U.keyboard.virtualKey =
            VK_CONTROL;

        inputs[3].U.keyboard.flags =
            KEYEVENTF_KEYUP;

        int inputSize =
            Marshal.SizeOf(
                typeof(INPUT)
            );

        uint sent =
            SendInput(
                (uint)inputs.Length,
                inputs,
                inputSize
            );

        if (
            sent !=
            (uint)inputs.Length
        )
        {
            throw new InvalidOperationException(
                "SendInput failed. Win32 error: " +
                Marshal.GetLastWin32Error()
            );
        }
    }

    private static void SendSingleKey(
        int key
    )
    {
        INPUT[] inputs =
            new INPUT[2];

        inputs[0].type = INPUT_KEYBOARD;
        inputs[0].U.keyboard.virtualKey =
            (ushort)key;

        inputs[1].type = INPUT_KEYBOARD;
        inputs[1].U.keyboard.virtualKey =
            (ushort)key;

        inputs[1].U.keyboard.flags =
            KEYEVENTF_KEYUP;

        int inputSize =
            Marshal.SizeOf(
                typeof(INPUT)
            );

        uint sent =
            SendInput(
                (uint)inputs.Length,
                inputs,
                inputSize
            );

        if (
            sent !=
            (uint)inputs.Length
        )
        {
            throw new InvalidOperationException(
                "SendInput failed. Win32 error: " +
                Marshal.GetLastWin32Error()
            );
        }
    }

    private void ParseShortcut(
        string shortcut
    )
    {
        if (
            String.IsNullOrWhiteSpace(
                shortcut
            )
        )
        {
            throw new InvalidOperationException(
                "Shortcut cannot be empty."
            );
        }

        _needControl = false;
        _needAlt = false;
        _needShift = false;
        _needWin = false;
        _shortcutKey = 0;

        foreach (
            string rawPart
            in shortcut.Split('+')
        )
        {
            string part =
                rawPart.Trim();

            switch (
                part.ToLowerInvariant()
            )
            {
                case "alt":
                    _needAlt = true;
                    break;

                case "control":
                case "ctrl":
                    _needControl = true;
                    break;

                case "shift":
                    _needShift = true;
                    break;

                case "win":
                case "windows":
                    _needWin = true;
                    break;

                case "space":
                    _shortcutKey = 0x20;
                    break;

                case "f1":
                    _shortcutKey = 0x70;
                    break;

                case "f2":
                    _shortcutKey = 0x71;
                    break;

                case "f3":
                    _shortcutKey = 0x72;
                    break;

                case "f4":
                    _shortcutKey = 0x73;
                    break;

                case "f5":
                    _shortcutKey = 0x74;
                    break;

                case "f6":
                    _shortcutKey = 0x75;
                    break;

                case "f7":
                    _shortcutKey = 0x76;
                    break;

                case "f8":
                    _shortcutKey = 0x77;
                    break;

                case "f9":
                    _shortcutKey = 0x78;
                    break;

                case "f10":
                    _shortcutKey = 0x79;
                    break;

                case "f11":
                    _shortcutKey = 0x7A;
                    break;

                case "f12":
                    _shortcutKey = 0x7B;
                    break;

                default:
                    if (part.Length == 1)
                    {
                        _shortcutKey =
                            (int)
                            Char.ToUpperInvariant(
                                part[0]
                            );
                    }
                    else
                    {
                        throw new InvalidOperationException(
                            "Unsupported shortcut key: " +
                            part
                        );
                    }

                    break;
            }
        }

        if (_shortcutKey == 0)
        {
            throw new InvalidOperationException(
                "Shortcut must contain a main key."
            );
        }
    }

    private void Log(string message)
    {
        try
        {
            string directory =
                Path.GetDirectoryName(
                    _logPath
                );

            if (
                !String.IsNullOrEmpty(
                    directory
                )
            )
            {
                Directory.CreateDirectory(
                    directory
                );
            }

            File.AppendAllText(
                _logPath,
                "[" +
                DateTime.Now.ToString(
                    "yyyy-MM-dd HH:mm:ss"
                ) +
                "] " +
                message +
                Environment.NewLine,
                Encoding.UTF8
            );
        }
        catch
        {
            // Logging must never terminate the host.
        }
    }
}

public static class Program
{
    private static void PrintLayouts()
    {
        List<KeyboardLayoutInfo> layouts =
            HotkeyForm.GetInstalledLayouts();

        IntPtr activeLayout =
            GetActiveKeyboardLayout();

        foreach (
            KeyboardLayoutInfo layout
            in layouts
        )
        {
            bool active =
                unchecked(
                    (uint)layout.Handle.ToInt64()
                ) ==
                unchecked(
                    (uint)activeLayout.ToInt64()
                );

            Console.WriteLine(
                layout.Id.PadRight(12) +
                " " +
                layout.Name +
                (
                    active
                        ? " [active]"
                        : String.Empty
                )
            );
        }
    }

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(
        IntPtr windowHandle,
        IntPtr processId
    );

    [DllImport("user32.dll")]
    private static extern IntPtr GetKeyboardLayout(
        uint threadId
    );

    private static IntPtr GetActiveKeyboardLayout()
    {
        IntPtr foreground =
            GetForegroundWindow();

        if (foreground == IntPtr.Zero)
        {
            return GetKeyboardLayout(0);
        }

        uint threadId =
            GetWindowThreadProcessId(
                foreground,
                IntPtr.Zero
            );

        return GetKeyboardLayout(
            threadId
        );
    }

    [STAThread]
    public static int Main(
        string[] args
    )
    {
        try
        {
            if (
                args.Length == 1 &&
                args[0] == "--layouts"
            )
            {
                PrintLayouts();
                return 0;
            }

            if (
                args.Length != 3 ||
                args[0] != "--run"
            )
            {
                Console.Error.WriteLine(
                    "Usage:"
                );

                Console.Error.WriteLine(
                    "  keyshift-host.exe --layouts"
                );

                Console.Error.WriteLine(
                    "  keyshift-host.exe --run <configPath> <logPath>"
                );

                return 2;
            }

            string configPath = args[1];
            string logPath = args[2];

            if (!File.Exists(configPath))
            {
                throw new FileNotFoundException(
                    "Config file was not found.",
                    configPath
                );
            }

            Application.EnableVisualStyles();

            Application.SetCompatibleTextRenderingDefault(
                false
            );

            Application.Run(
                new HotkeyForm(
                    configPath,
                    logPath
                )
            );

            return 0;
        }
        catch (Exception exception)
        {
            try
            {
                string logPath =
                    args.Length >= 3
                        ? args[2]
                        : Path.Combine(
                            Path.GetTempPath(),
                            "keyshift-host.log"
                        );

                string directory =
                    Path.GetDirectoryName(
                        logPath
                    );

                if (
                    !String.IsNullOrEmpty(
                        directory
                    )
                )
                {
                    Directory.CreateDirectory(
                        directory
                    );
                }

                File.AppendAllText(
                    logPath,
                    "[" +
                    DateTime.Now.ToString(
                        "yyyy-MM-dd HH:mm:ss"
                    ) +
                    "] Startup error: " +
                    exception +
                    Environment.NewLine,
                    Encoding.UTF8
                );
            }
            catch
            {
                // Ignore logging errors.
            }

            Console.Error.WriteLine(
                exception.ToString()
            );

            return 1;
        }
    }
}