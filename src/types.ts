export type LayoutMode = "auto" | "pair";

export type DirectionDetection =
  | "hybrid"
  | "content"
  | "active-layout";

export interface KeyShiftConfig {
  shortcut: string;

  /**
   * auto:
   * Direction is detected from the text and active Windows layout.
   *
   * pair:
   * Conversion always runs from sourceLayout to targetLayout.
   */
  layoutMode: LayoutMode;

  /**
   * Windows keyboard layout identifier, for example:
   * 00000409 = English US
   * 00000429 = Persian
   */
  sourceLayout: string;
  targetLayout: string;

  directionDetection: DirectionDetection;

  preserveClipboard: boolean;
  copyDelayMs: number;
  pasteDelayMs: number;

  /**
   * Existing KeyShift behaviour selects all text before conversion.
   * Set this to false to convert only the currently selected text.
   */
  selectAllText: boolean;
}