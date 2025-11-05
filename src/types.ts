import { MouseButtons } from "./data";
import type { ValueOf } from "./util";

export type CellType = "seat" | "aisle" | "wall" | "door" | "custom";

export type PureCell = {
    name?: string;
    type: CellType;
    styleOverride?: CellStyleOverride;
}

export type Cell = PureCell | null;

export type CellState = "hover" | "selected" | "default";

export type CellStyleOverridePure = {
    backgroundColor?: string;
    borderColor?: string;
    borderWidth?: number;
    borderTop?: boolean;
    borderBottom?: boolean;
    borderLeft?: boolean;
    borderRight?: boolean;
    text?: string;
    textFont?: string;
    textWeight?: string;
    textSize?: number;
    textColor?: string;
    textOpacity?: number;
    textTranslateX?: number;
    textTranslateY?: number;
    textStrokeColor?: string;
    textStrokeLineWidth?: number;
    textRotationDegrees?: number;
    opacity?: number;
}

export type CellStyleOverride = CellStyleOverridePure & {
    hoverOverride?: CellStyleOverridePure,
    selectedOverride?: CellStyleOverridePure
}

export type PossibleZoomLevels = 0.8 | 1 | 1.2 | 1.5 | 2 | 3 | 4 | 5 | 6;

export type MapLayoutInput = {
    x: number;
    y: number;
    cells: (Cell | `${number}`)[]; // putting an Int will create the Ints amount of null cells
    globalOverride?: {
        backgroundColor?: string;
        zoomLevel?: PossibleZoomLevels;
        cellStyleOverride?: {
            seat?: CellStyleOverride
            aisle?: CellStyleOverride
            wall?: CellStyleOverride
            door?: CellStyleOverride
            custom?: CellStyleOverride
        }
    }
};

export type MapLayout = {
    x: number;
    y: number;
    cells: Cell[];
    globalOverride: {
        backgroundColor: string;
        zoomLevel: PossibleZoomLevels;
        cellStyleOverride: {
            seat?: CellStyleOverride
            aisle?: CellStyleOverride
            wall?: CellStyleOverride
            door?: CellStyleOverride
            custom?: CellStyleOverride
        }
    }
};

export type Collision<ref> = {
    x: number;
    y: number;
    width: number;
    height: number;
    reference: ref | -1;
}

export type EditMenuState = {
    input: {
        property: keyof CellStyleOverridePure | null;
        value: ValueOf<CellStyleOverridePure>;
    },
    animations: {
        blinkingCursor: {
            lastTick: number;
            lastState: "visible" | "hidden";
            interval: number;
        }
    },
    selectedInput: string | null,
    selectedStyleState: CellState;
    selectedType: CellType;
    cellStyleChanges: CellStyleOverride;
    selectedCells: {
        readonly indexes: number[];
        type: CellType | null;
        editState: CellState;
    } | null;
    openGroups: number[];
}

export type EditMenuElement = {
    label: string;
} & ({
    type: "input";
    value: keyof CellStyleOverridePure;
} | {
    type: "button";
    action: () => void;
} | {
    type: "checkbox";
    value: keyof CellStyleOverridePure;
} | {
    type: "label";
} | {
    type: "hselect";
    options: string[];
} | {
    type: "group";
    elements: EditMenuElement[];
})

export type MapMode = "view" | "edit" | "preview" | "no-interact";

export type CollisionCallback<ref> = ((collision: Collision<ref>, buttons?: MouseButtons[]) => void);
export type DragCallback = ((diffX: number, diffY: number, buttons: MouseButtons[]) => void);

export type MapRenderInstruction = {
    x: number;
    y: number;
    opacity: number;
} &
    (
        (
            (
                {
                    font: string;
                    color: string;
                    text: string;
                    rotationDegrees: number;
                    dimensions: [number, number];
                } & (
                    {
                        type: "text";
                    } | {
                        type: "textstroke";
                        lineWidth: number;
                    }
                )
            ) | {
                type: "path";
                path: string;
                color: string;
            }
        ) | (
            {
                xTo: number;
                yTo: number;
            } & (
                {
                    type: "line";
                    color: string;
                    lineWidth: number;
                }
            )
        )
        |
        (
            {
                width: number;
                height: number;
            } & (
                {
                    type: "fillrect";
                    color: string;
                } | {
                    type: "strokerect";
                    color: string;
                    lineWidth: number;
                }
            )
        )
    )

export type MergingInstruction1D = {
    direction: LineDirection,
    startX: number,
    startY: number,
    instructionIndices: number[],
    opacity: number,
    color: string
} & (
        {
            type: "line",
            lineWidth: number,
        } | {
            type: "fillrect",
            color: string,
            width: number,
            height: number
        }
    )

export enum LineDirection {
    Horizontal,
    Vertical,
    Diagonal
}

export enum KeyboardRunReason {
    Interval,
    KeyDown,
    KeyUp
}
export enum CopyMode {
    Copy,
    Cut,
    Paste
}


export type ExtendedTouch = { identifier: number, pageX: number, pageY: number, hasMoved: boolean };