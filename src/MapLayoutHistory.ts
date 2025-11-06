import type { Cell, CellStyleOverride, MapLayout, PureCell } from "./types";

type Action = "changeAttribute" | "swappedCell" | "swappedCells";

type attributeContent = ("seat" | "aisle" | "wall" | "door" | "custom") & (CellStyleOverride | undefined);

type MapLayoutHistoryEntry = {
    action: "changeAttribute",
    index: number,
    attribute: keyof PureCell,
    was: attributeContent,
    became: attributeContent
} | {
    action: "changeAttributes",
    index: number[],
    attribute: keyof PureCell,
    was: attributeContent[],
    became: attributeContent[]
} | {
    action: "swappedCell",
    index: number,
    was: Cell,
    became: Cell
} | {
    action: "swappedCells",
    index: number[],
    was: Cell[],
    became: Cell[]
}


export class MapLayoutHistory {
    private history: MapLayoutHistoryEntry[] = [];
    private i: number = 0;

    constructor(public readonly mapLayout: MapLayout) { };

    undo() {
        if (this.history.length === 0) {
            return false;
        }

        if (this.i !== 0) {
            this.i--;
        }

        const entry = this.history[this.i];

        if (entry === undefined) {
            console.error("Cannot undo when no history entry is present for desired step.")

            return;
        }

        if (entry.action === "swappedCell") {
            this.mapLayout.cells[entry.index] = entry.was;
        } else if (entry.action === "changeAttribute") {
            const cell = this.mapLayout.cells[entry.index];

            if (cell === undefined || cell === null) {
                console.error("Cannot change attribute on cell that doesn't exist");

                return;
            }

            cell[entry.attribute] = entry.was;
        } else if (entry.action === "changeAttributes") {
            for (let i = 0; i < entry.index.length; i++) {
                const cellIndex = entry.index[i];
                if (cellIndex === undefined || this.mapLayout.cells[cellIndex] === null) {
                    return;
                }

                const cell = this.mapLayout.cells[cellIndex];

                if (cell === undefined || cell === null) {
                    console.error("Cannot change attribute on cell that doesn't exist");

                    return;
                }

                const was = entry.was[i];

                if (was === undefined) {
                    console.error("Cannot change attribute with undefined was.");
                }

                cell[entry.attribute] = was;
            }
        } else if (entry.action === "swappedCells") {
            for (let i = 0; i < entry.index.length; i++) {
                this.mapLayout.cells[entry.index[i]] = entry.was[i];
            }
        }
    }

    redo() {
        if (this.history.length === 0) {
            return;
        }

        const entry = this.history[this.i];

        if (entry === undefined) {
            console.error("Cannot redo when no history entry is present for desired step.")

            return;
        }

        if (entry.action === "swappedCell") {
            this.mapLayout.cells[entry.index] = entry.became;
        } else if (entry.action === "changeAttribute") {
            if (this.mapLayout.cells[entry.index] === null) {
                return;
            }

            this.mapLayout.cells[entry.index][entry.attribute] = entry.became;
        } else if (entry.action === "changeAttributes") {
            for (let i = 0; i < entry.index.length; i++) {
                if (this.mapLayout.cells[entry.index[i]] === null) {
                    return;
                }

                this.mapLayout.cells[entry.index[i]][entry.attribute] = entry.became[i];
            }
        } else if (entry.action === "swappedCells") {
            for (let i = 0; i < entry.index.length; i++) {
                this.mapLayout.cells[entry.index[i]] = entry.became[i];
            }
        }

        this.i++;
    }

    swapCell(index: number, from: Cell, to: Cell) {
        this.mapLayout.cells[index] = to;

        this.addHistoryEntry({
            action: "swappedCell",
            index,
            was: from,
            became: to
        })
    }

    swapCells(index: number[], from: Cell[], to: Cell[]) {
        for (let i = 0; i < index.length; i++) {
            this.mapLayout.cells[index[i]] = this.deepClone(to[i]);
        }

        this.addHistoryEntry({
            action: "swappedCells",
            index,
            was: from,
            became: to
        })
    }

    private deepClone(obj: any) {
        return JSON.parse(JSON.stringify(obj));
    }

    changeAttribute(index: number, attribute: keyof PureCell, from: attributeContent, to: attributeContent) {
        // @ts-expect-error
        this.mapLayout.cells[index][attribute] = to;

        this.addHistoryEntry({
            action: "changeAttribute",
            index,
            attribute,
            was: from,
            became: to
        })
    }
    changeAttributes(index: number[], attribute: keyof PureCell, from: attributeContent[], to: attributeContent[]) {
        for (let i = 0; i < index.length; i++) {
            // @ts-expect-error
            this.mapLayout.cells[index[i]][attribute] = to[i];
        }
        this.addHistoryEntry({
            action: "changeAttributes",
            index,
            attribute,
            was: from,
            became: to
        })
    }

    private addHistoryEntry(entry: MapLayoutHistoryEntry) {
        if (this.history.length > this.i + 1) {
            this.history.length = this.i + 1;
        }

        this.history.push({
            ...entry,
            was: this.deepClone(entry.was),
            became: this.deepClone(entry.became)
        });

        this.i = this.history.length;
    }
}