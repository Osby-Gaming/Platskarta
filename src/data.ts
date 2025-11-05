import { text } from "stream/consumers";
import type { CellStyleOverride, CellType, PossibleZoomLevels } from "./types";

export const CELL_SIZE = 25; // Size of each cell in pixels
export const ZOOM_LEVELS = [0.8, 1, 1.2, 1.5, 2, 3, 4, 6, 7]; // Predefined zoom levels
export const MAX_ZOOM = ZOOM_LEVELS[ZOOM_LEVELS.length - 1]; // Maximum zoom level

export const DEFAULT_MAP_BACKGROUND_COLOR = "#000";
export const DEFAULT_ZOOM_LEVEL: PossibleZoomLevels = 1;

const COMMON_DEFAULT_CELL_STYLES: CellStyleOverride = {
    backgroundColor: "#0F0",
    borderColor: "#000",
    borderWidth: 1,
    borderTop: false,
    borderBottom: false,
    borderLeft: false,
    borderRight: false,
    text: "",
    textFont: "Arial",
    textWeight: "normal",
    textSize: 12,
    textColor: "#000",
    textOpacity: 1,
    textTranslateX: 0,
    textTranslateY: 0,
    textStrokeColor: "",
    textStrokeLineWidth: 0,
    textRotationDegrees: 0,
    opacity: 1,
}

export const DEFAULT_CELL_STYLES: Record<CellType, CellStyleOverride> = {
    seat: {
        ...COMMON_DEFAULT_CELL_STYLES,
        hoverOverride: {
            borderWidth: 2,
            opacity: 0.7,
        },
        selectedOverride: {
            opacity: 0.5,
        }
    },
    aisle: {
        ...COMMON_DEFAULT_CELL_STYLES,
        backgroundColor: "#FFF",
    },
    wall: {
        ...COMMON_DEFAULT_CELL_STYLES,
        backgroundColor: "gray",
    },
    door: {
        ...COMMON_DEFAULT_CELL_STYLES,
        backgroundColor: "#F00",
    },
    custom: {
        ...COMMON_DEFAULT_CELL_STYLES,
        backgroundColor: "#FFF",
    }
}

export const EDITMENU_LABELS: Record<string, string> = {
    backgroundColor: "Background Color",
    borderColor: "Border Color",
    borderWidth: "Border Width",
    borderTop: "Show Top Border",
    borderBottom: "Show Bottom Border",
    borderLeft: "Show Left Border",
    borderRight: "Show Right Border",
    text: "Text",
    textFont: "Text Font",
    textWeight: "Text Weight (font-weight)",
    textSize: "Text Size (px)",
    textColor: "Text Color",
    textOpacity: "Text Opacity",
    textTranslateX: "Text Translate X",
    textTranslateY: "Text Translate Y",
    textStrokeColor: "Text Stroke Color",
    textStrokeLineWidth: "Text Stroke Line Width",
    textRotationDegrees: "Text Rotation (degrees)",
    opacity: "Opacity",
    default_text1: "Click on a cell to edit it",
    btn_apply: "Apply",
    hslct_edit_state: "Choose Cell State",
    default: "Default",
    hover: "Hover",
    selected: "Select",
    hslct_type: "Choose Cell Type",
    seat: "Seat",
    aisle: "Aisle",
    wall: "Wall",
    door: "Door",
    custom: "Custom",
    btn_export: "Export",
    btn_toggle_preview: "Toggle Preview",
    btn_save: "Save",
    locked_cells_warning: "Some selected cells are locked and cannot be edited.",
    background: "Background",
    border: "Border",
};

export const CELL_STYLE_GROUPS = [
    {
        label: "text",
        startsWith: "text",
    },
    {
        label: "background",
        startsWith: "background",
    },
    {
        label: "border",
        startsWith: "border",
    }
];

export const CELL_STYLE_INPUT_TYPES: Record<string, string> = {
    backgroundColor: "input",
    borderColor: "input",
    borderWidth: "input",
    borderTop: "checkbox",
    borderBottom: "checkbox",
    borderLeft: "checkbox",
    borderRight: "checkbox",
    text: "input",
    textColor: "input",
    textFont: "input",
    textWeight: "input",
    textSize: "input",
    textOpacity: "input",
    textTranslateX: "input",
    textTranslateY: "input",
    textStrokeColor: "input",
    textStrokeLineWidth: "input",
    textRotationDegrees: "input",
    opacity: "input",
}

export const CELL_STYLE_KEYS = Object.keys(CELL_STYLE_INPUT_TYPES);

export enum MouseButtons {
    LEFT = 0,
    MIDDLE = 1,
    RIGHT = 2,
    BACK = 3,
    FORWARD = 4
}

export const SVGPaths = {
    copy: "M89.62,13.96v7.73h12.19h0.01v0.02c3.85,0.01,7.34,1.57,9.86,4.1c2.5,2.51,4.06,5.98,4.07,9.82h0.02v0.02 v73.27v0.01h-0.02c-0.01,3.84-1.57,7.33-4.1,9.86c-2.51,2.5-5.98,4.06-9.82,4.07v0.02h-0.02h-61.7H40.1v-0.02 c-3.84-0.01-7.34-1.57-9.86-4.1c-2.5-2.51-4.06-5.98-4.07-9.82h-0.02v-0.02V92.51H13.96h-0.01v-0.02c-3.84-0.01-7.34-1.57-9.86-4.1 c-2.5-2.51-4.06-5.98-4.07-9.82H0v-0.02V13.96v-0.01h0.02c0.01-3.85,1.58-7.34,4.1-9.86c2.51-2.5,5.98-4.06,9.82-4.07V0h0.02h61.7 h0.01v0.02c3.85,0.01,7.34,1.57,9.86,4.1c2.5,2.51,4.06,5.98,4.07,9.82h0.02V13.96L89.62,13.96z M79.04,21.69v-7.73v-0.02h0.02 c0-0.91-0.39-1.75-1.01-2.37c-0.61-0.61-1.46-1-2.37-1v0.02h-0.01h-61.7h-0.02v-0.02c-0.91,0-1.75,0.39-2.37,1.01 c-0.61,0.61-1,1.46-1,2.37h0.02v0.01v64.59v0.02h-0.02c0,0.91,0.39,1.75,1.01,2.37c0.61,0.61,1.46,1,2.37,1v-0.02h0.01h12.19V35.65 v-0.01h0.02c0.01-3.85,1.58-7.34,4.1-9.86c2.51-2.5,5.98-4.06,9.82-4.07v-0.02h0.02H79.04L79.04,21.69z M105.18,108.92V35.65v-0.02 h0.02c0-0.91-0.39-1.75-1.01-2.37c-0.61-0.61-1.46-1-2.37-1v0.02h-0.01h-61.7h-0.02v-0.02c-0.91,0-1.75,0.39-2.37,1.01 c-0.61,0.61-1,1.46-1,2.37h0.02v0.01v73.27v0.02h-0.02c0,0.91,0.39,1.75,1.01,2.37c0.61,0.61,1.46,1,2.37,1v-0.02h0.01h61.7h0.02 v0.02c0.91,0,1.75-0.39,2.37-1.01c0.61-0.61,1-1.46,1-2.37h-0.02V108.92L105.18,108.92z"
}