import CollisionManager from "./CollisionManager";
import { CELL_STYLE_GROUPS, CELL_STYLE_INPUT_TYPES, CELL_STYLE_KEYS, EDITMENU_LABELS } from "./data";
import type { Cell, CellState, CellStyleOverride, CellStyleOverridePure, CellType, Collision, EditMenuElement, EditMenuState } from "./types";
import { EventEmitter, FPSCounter } from "./util";
import Map from "./Map";

const SCROLLBAR_WIDTH = 3;

class Toolbelt extends EventEmitter<{
    generateSeatLabels: void;
    deleteCells: void;
}> {
    el: HTMLElement;

    buttons: {
        generateSeatLabels: HTMLButtonElement,
        deleteCells: HTMLButtonElement
    };

    constructor(toolbeltId: string) {
        super();

        const element = document.getElementById(toolbeltId);

        if (!element) {
            throw new Error("Toolbelt element not found")
        }

        this.el = element;

        const generateSeatLabels = this.el.querySelector("button#generate-labels") as HTMLButtonElement;
        if (!generateSeatLabels) {
            throw new Error("Generate labels button not found in toolbelt");
        }

        const deleteCells = this.el.querySelector("button#delete-cells") as HTMLButtonElement;
        if (!deleteCells) {
            throw new Error("Delete cells button not found in toolbelt");
        }

        this.buttons = {
            generateSeatLabels,
            deleteCells
        }

        this.setListeners();
    }

    private setListeners() {
        this.buttons.generateSeatLabels.addEventListener("click", () => {
            this.emit("generateSeatLabels", undefined);
        });
        this.buttons.deleteCells.addEventListener("click", () => {
            this.emit("deleteCells", undefined);
        });
    }
}

export default class EditMenu {
    map: Map;

    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    input: HTMLInputElement;

    toolbelt: Toolbelt;

    collisions: CollisionManager<string>;

    fpsCounter: FPSCounter = new FPSCounter();

    lockedCells: number[];

    /**
     * State must always be stringifyable.
     */
    state: EditMenuState = {
        input: {
            property: null,
            value: ""
        },
        animations: {
            blinkingCursor: {
                lastTick: 0,
                lastState: "hidden",
                interval: 500 as const
            }
        },
        selectedStyleState: "default",
        selectedType: "seat",
        selectedInput: null,
        cellStyleChanges: {},
        selectedCells: null,
        openGroups: []
    }

    scroll: {
        offset: number,
        lastFrameHeight: number
    } = {
            offset: 0,
            lastFrameHeight: 0
        }

    lastFrameState: EditMenuState = JSON.parse(JSON.stringify(this.state));

    elements: EditMenuElement[] = [];

    constructor(map: Map, editMenuId: string, lockedCells: number[], toolbeltId: string) {
        this.map = map;

        this.lockedCells = lockedCells;

        const canvas = document.querySelector(`#${editMenuId} > canvas`);
        if (canvas === null) {
            throw new Error(`Canvas element for ID ${editMenuId} not found.`);
        }

        this.canvas = canvas as HTMLCanvasElement;

        this.collisions = new CollisionManager(this);

        this.canvas.width = this.canvas.offsetWidth;
        this.canvas.height = this.canvas.offsetHeight;

        this.ctx = this.canvas.getContext("2d") as CanvasRenderingContext2D;

        let input = document.querySelector(`#${editMenuId} > input`);
        if (input === null) {
            throw new Error(`Input element for ID ${editMenuId} not found.`);
        }

        this.input = input as HTMLInputElement;

        this.toolbelt = new Toolbelt(toolbeltId);

        this.toolbelt.on("generateSeatLabels", () => {
            this.generateSeatLabels();
        })
        this.toolbelt.on("deleteCells", () => {
            this.deleteCells();
        });

        this.input.addEventListener("input", event => this.handleInputChange(event));

        this.canvas.onkeydown = (event) => {
            if (event.key === "Escape") {
                if (!this.state.selectedCells) {
                    return;
                }

                this.map.unselectCells();
                this.canvas.focus();
            }
        }

        this.canvas.onwheel = (event) => {
            if (this.scroll.lastFrameHeight > this.canvas.height) {
                this.scroll.offset -= event.deltaY;
                this.scroll.offset = Math.min(0, this.scroll.offset);
                this.scroll.offset = Math.max(-this.scroll.lastFrameHeight + this.canvas.height, this.scroll.offset);
                this.render();
            }
        }

        this.input.onkeydown = (event) => {
            if (event.key === "Enter") {
                if (this.state.selectedInput !== null) {
                    this.applyToMap();
                }
            }

            if (event.key === "Escape") {
                this.input.blur();
                this.unselectInput();
                this.canvas.focus();
            }

            if (event.key === "Tab") {
                event.preventDefault();

                if (this.state.selectedInput !== null) {
                    this.selectInput(this.getNextInputRef(this.state.selectedInput));
                }
            }
        }

        this.input.onblur = () => {
            this.unselectInput();
        }

        this.collisions.addEventListener("click", (collision: Collision<string>) => this.handleClickCollisions(collision));

        setInterval(() => this.runAnimations(), 50);

        this.unSelectCell();

        this.render();
    }

    private deleteCells() {
        const selection = this.state.selectedCells?.indexes || [];

        const swap: {
            index: number[],
            was: Cell[],
            became: Cell[]
        } = {
            index: [],
            was: [],
            became: []
        }

        for (const index of selection) {
            if (this.lockedCells.includes(index)) {
                continue;
            }

            if (this.map.history.mapLayout.cells[index] === undefined) {
                continue;
            }

            swap.index.push(index);
            swap.was.push(this.map.history.mapLayout.cells[index]);
            swap.became.push(null);
        }

        this.map.history.swapCells(swap.index, swap.was, swap.became);

        this.unSelectCell();
        this.selectCells(selection);

        this.map.render();
    }

    private generateSeatLabels() {
        const { mapLayout } = this.map.history;
        if (!this.map || !mapLayout || !mapLayout.cells) {
            console.error("Map or map layout is not defined.");
            return;
        }

        const cells = (mapLayout.cells.map((cell, index) => [cell, index]) as [Cell, number][]).filter(([cell]) => cell !== null && cell.type === "seat");

        let number = 1;

        const setNames: {
            index: number[],
            name: string[],
            oldNames: (string | undefined)[]
        } = {
            index: [],
            name: [],
            oldNames: []
        }

        for (const cellInfo of cells) {
            const cell = cellInfo[0];
            const index = cellInfo[1];

            if (!cell) {
                console.error("Error #357");

                continue;
            }

            setNames.oldNames.push(cell.name);

            cell.name = (number++).toString();

            setNames.index.push(index);
            setNames.name.push(cell.name);
        }

        // @ts-expect-error
        this.map.history.changeAttributes(setNames.index, "name", setNames.name, setNames.name);

        this.map.render();
    }

    parseRef(ref: string) {
        let controlSymbol: string | null = null;

        if (ref.endsWith("-") || ref.endsWith("+")) {
            controlSymbol = ref.slice(-1);

            ref = ref.slice(0, -1);
        }

        if (ref.includes("_")) {
            const match = ref.match(/^(\d+)_(\d+)$/);

            if (!match || !match[1] || !match[2]) {
                return null;
            }

            return {
                groupIndex: parseInt(match[1]),
                itemIndex: parseInt(match[2]),
                controlSymbol
            }
        }
        if (!isNaN(parseInt(ref))) {
            return {
                groupIndex: null,
                itemIndex: parseInt(ref),
                controlSymbol
            }
        }

        return null;
    }

    getInputByRef(ref: string) {
        const inputIndices = this.parseRef(ref);

        if (inputIndices === null) {
            return null;
        }

        if (inputIndices.groupIndex === null) {
            return this.elements[inputIndices.itemIndex];
        }

        const group = this.elements[inputIndices.groupIndex];

        if (!group || group.type !== "group") {
            return null;
        }

        return group.elements[inputIndices.itemIndex];
    }

    getNextInputRef(ref: string) {
        const inputIndices = this.parseRef(ref);

        if (inputIndices === null) {
            return null;
        }

        const availableRefs = this.elements.filter(element => element.type === "input").map((_, i) => i.toString());

        const groupedRefs = this.elements.map((element, index) => {
            if (element.type !== "group") {
                return "";
            } else {
                return element.elements.map((_, subindex) => `${index}_${subindex}`);
            }
        }).filter(el => el !== "");

        const allRefs = [...availableRefs, ...groupedRefs.flat()].sort((a: string, b: string) => {
            const aIndices = this.parseRef(a);
            const bIndices = this.parseRef(b);

            if (aIndices === null || bIndices === null) {
                console.error("invalid ref in sort");

                return 0;
            }

            if (aIndices.groupIndex === null && bIndices.groupIndex === null) {
                return aIndices.itemIndex - bIndices.itemIndex;
            }
            if (aIndices.groupIndex === null && bIndices.groupIndex !== null) {
                return aIndices.itemIndex - bIndices.groupIndex;
            }
            if (aIndices.groupIndex !== null && bIndices.groupIndex == null) {
                return aIndices.groupIndex - bIndices.itemIndex;
            }

            return 0;
        });

        for (let i = 0; i < allRefs.length; i++) {
            if (allRefs[i] === ref) {
                if (i + 1 < allRefs.length) {
                    return allRefs[i + 1];
                }
                return allRefs[0];
            }
        }

        return null;
    }

    selectInput(ref: string | null | undefined) {
        if (ref === null || ref === undefined) {
            return this.unselectInput();
        }

        const element = this.getInputByRef(ref);

        if (element && element.type === "input") {
            this.state.input.property = element.value as keyof CellStyleOverridePure;
            this.state.input.value = this.cellStyleChangesByKey(element.value as keyof CellStyleOverridePure);
            this.input.value = this.state.input.value?.toString() || "";
            this.input.focus();
            this.state.selectedInput = ref;
            this.state.animations.blinkingCursor.lastTick = Date.now();
            this.state.animations.blinkingCursor.lastState = "visible";
        }
    }

    unselectInput() {
        this.state.selectedInput = null;
        this.state.input.property = null;
        this.state.input.value = "";
        this.input.value = "";

        this.renderIfStateChanged();
    }

    runAnimations() {
        if (this.state.selectedInput !== null) {
            if (Date.now() - this.state.animations.blinkingCursor.interval > this.state.animations.blinkingCursor.lastTick) {
                this.state.animations.blinkingCursor.lastTick = Date.now();

                if (this.state.animations.blinkingCursor.lastState === "visible") {
                    this.state.animations.blinkingCursor.lastState = "hidden";
                } else {
                    this.state.animations.blinkingCursor.lastState = "visible";
                }
            }
        }

        this.renderIfStateChanged();
    }

    cellStyleChangesByKey(key: keyof CellStyleOverridePure) {
        if (this.state.selectedStyleState === "default") {
            return this.state.cellStyleChanges[key];
        } else if (this.state.selectedStyleState === "hover") {
            if (this.state.cellStyleChanges.hoverOverride) {
                return this.state.cellStyleChanges.hoverOverride[key];
            }
        } else if (this.state.selectedStyleState === "selected") {
            if (this.state.cellStyleChanges.selectedOverride) {
                return this.state.cellStyleChanges.selectedOverride[key];
            }
        }

        return "";
    }

    handleClickCollisions(collision: Collision<string>) {
        if (collision.reference === -1) {
            return;
        }

        const el = this.getInputByRef(collision.reference);

        if (el === null || el === undefined) {
            return;
        }

        const ref = this.parseRef(collision.reference);

        if (ref === null) {
            return;
        }

        if (ref.controlSymbol) {
            // HSelect arrow click

            if (el.type === "hselect") {
                if (el.label === "hslct_edit_state") {
                    let selectedIndex = el.options.indexOf(this.state.selectedStyleState);

                    if (ref.controlSymbol === "-") {
                        if (selectedIndex > 0) {
                            selectedIndex--;
                        }
                    } else if (ref.controlSymbol === "+") {
                        if (selectedIndex < el.options.length - 1) {
                            selectedIndex++;
                        }
                    }

                    this.state.selectedStyleState = el.options[selectedIndex] as CellState;

                    this.state.selectedInput = null; // Unselect input when changing state
                } else if (el.label === "hslct_type") {
                    let selectedIndex = el.options.indexOf(this.state.selectedType);

                    if (ref.controlSymbol === "-") {
                        if (selectedIndex > 0) {
                            selectedIndex--;
                        }
                    } else if (ref.controlSymbol === "+") {
                        if (selectedIndex < el.options.length - 1) {
                            selectedIndex++;
                        }
                    }

                    this.state.selectedType = el.options[selectedIndex] as CellType;
                }
            }
        } else {
            if (el.type === "input") {
                this.selectInput(collision.reference)
            } else if (el.type === "button") {
                el.action();
            } else if (el.type === "checkbox") {
                if (this.state.selectedStyleState === "default") {
                    // @ts-expect-error
                    this.state.cellStyleChanges[el.value as keyof CellStyleOverridePure] = !this.state.cellStyleChanges[el.value as keyof CellStyleOverridePure];
                }

                if (this.state.selectedStyleState === "hover") {
                    if (this.state.cellStyleChanges.hoverOverride === undefined) {
                        this.state.cellStyleChanges.hoverOverride = {};
                    }

                    //@ts-expect-error
                    this.state.cellStyleChanges.hoverOverride[el.value as keyof CellStyleOverridePure] = !this.state.cellStyleChanges.hoverOverride[el.value as keyof CellStyleOverridePure];
                }

                if (this.state.selectedStyleState === "selected") {
                    if (this.state.cellStyleChanges.selectedOverride === undefined) {
                        this.state.cellStyleChanges.selectedOverride = {};
                    }

                    //@ts-expect-error
                    this.state.cellStyleChanges.selectedOverride[el.value as keyof CellStyleOverridePure] = !this.state.cellStyleChanges.selectedOverride[el.value as keyof CellStyleOverridePure];
                }
            } else if (el.type === "group") {
                if (this.state.openGroups.includes(ref.itemIndex)) {
                    this.state.openGroups = this.state.openGroups.filter(i => i !== ref.itemIndex);
                } else {
                    this.state.openGroups.push(ref.itemIndex);
                }
            }
        }

        this.renderIfStateChanged();
    }

    handleInputChange(event: Event) {
        if (!this.state.selectedCells) {
            return;
        }

        this.state.input.value = (event.target as HTMLInputElement).value;

        if (this.state.input.property && this.state.selectedInput !== null) {
            const element = this.getInputByRef(this.state.selectedInput);

            if (element && element.type === "input") {
                if (this.state.selectedStyleState === "default") {
                    // @ts-ignore
                    this.state.cellStyleChanges[this.state.input.property as keyof CellStyleOverride] = this.state.input.value;
                }

                if (this.state.selectedStyleState === "hover") {
                    if (this.state.cellStyleChanges.hoverOverride === undefined) {
                        this.state.cellStyleChanges.hoverOverride = {};
                    }

                    //@ts-ignore
                    this.state.cellStyleChanges.hoverOverride[this.state.input.property] = this.state.input.value;
                }

                if (this.state.selectedStyleState === "selected") {
                    if (this.state.cellStyleChanges.selectedOverride === undefined) {
                        this.state.cellStyleChanges.selectedOverride = {};
                    }

                    //@ts-ignore
                    this.state.cellStyleChanges.selectedOverride[this.state.input.property] = this.state.input.value;
                }
            }
        }

        this.render();
    }

    unSelectCell() {
        this.input.blur();

        this.elements = [];

        this.elements.push({
            type: "label",
            label: "default_text1"
        }, {
            type: "button",
            label: "btn_export",
            action: () => {
                let a = document.createElement("a");
                let file = new Blob([JSON.stringify(this.map.exportMapLayout())], { type: "JSON" });
                a.href = URL.createObjectURL(file);
                a.download = "test.json";
                a.click();
            }
        }, {
            type: "button",
            label: "btn_save",
            action: () => {
                this.map.emit("save", this.map.exportMapLayout());
            }
        }, {
            type: "button",
            label: "btn_toggle_preview",
            action: () => {
                this.map.togglePreview();
            }
        })

        this.state.selectedInput = null;
        this.state.input.property = null;
        this.state.input.value = "";
        this.input.value = "";
        this.state.cellStyleChanges = {};
        this.state.selectedCells = null;
        this.state.selectedStyleState = "default";
        this.state.selectedType = "seat";
        this.scroll.offset = 0;

        this.render();
    }

    selectCells(cellIndexes: number[]) {
        if (cellIndexes.length === 0) {
            this.unSelectCell();

            return;
        }

        for (let i = 0; i < cellIndexes.length; i++) {
            const index = cellIndexes[i];

            if (index === undefined) {
                console.error(`Undefined index in selectCells`);

                return;
            }

            const cell2 = this.map.history.mapLayout.cells[index];

            if (cell2 === undefined) {
                console.error(`No cell found at index: ${cellIndexes[i]}`);

                return;
            }
        }

        const elements: EditMenuElement[] = [];

        elements.push({
            type: "hselect",
            label: "hslct_type",
            options: [
                "seat",
                "aisle",
                "wall",
                "door",
                "custom"
            ]
        });

        elements.push({
            type: "hselect",
            label: "hslct_edit_state",
            options: [
                "default",
                "hover",
                "selected"
            ]
        });

        for (const group of CELL_STYLE_GROUPS) {
            elements.push({
                label: group.label,
                type: "group",
                elements: CELL_STYLE_KEYS.filter(key => key.startsWith(group.startsWith) || key === group.startsWith).map(key => ({
                    type: CELL_STYLE_INPUT_TYPES[key],
                    label: key,
                    value: key as keyof CellStyleOverridePure
                } as EditMenuElement))
            })
        }

        for (const key of CELL_STYLE_KEYS) {
            if (CELL_STYLE_GROUPS.some(group => group.startsWith === key.substring(0, group.startsWith.length))) {
                continue;
            }

            elements.push({
                type: CELL_STYLE_INPUT_TYPES[key],
                label: key,
                value: key as keyof CellStyleOverridePure
            } as EditMenuElement);
        }

        elements.push({
            type: "button",
            label: "btn_apply",
            action: () => this.applyToMap()
        })

        if (this.lockedCells.some(index => cellIndexes.includes(index))) {
            this.elements = [
                {
                    type: "label",
                    label: "locked_cells_warning"
                }
            ]
        } else {
            this.elements = elements;
        }

        const firstCellIndex = cellIndexes[0];

        if (firstCellIndex === undefined) {
            console.error("First cell index is undefined.")

            this.unSelectCell();

            return;
        }

        const cell = this.map.history.mapLayout.cells[firstCellIndex];

        this.state.selectedCells = {
            indexes: cellIndexes,
            editState: "default",
            type: cell?.type || null
        }

        this.state.selectedType = cell?.type || "seat";
        this.scroll.offset = 0;

        for (const key of CELL_STYLE_KEYS) {
            if (this.map.history.mapLayout.cells[firstCellIndex]?.styleOverride?.[key as keyof CellStyleOverridePure] !== undefined &&this.isPropertyCommonToAllCells(key as keyof CellStyleOverridePure, this.map.history.mapLayout.cells[firstCellIndex]?.styleOverride?.[key as keyof CellStyleOverridePure], "default")) {
                // @ts-expect-error
                this.state.cellStyleChanges[key as keyof CellStyleOverridePure] = this.map.history.mapLayout.cells[cellIndexes[0]]?.styleOverride?.[key as keyof CellStyleOverridePure];
            }
            if (this.map.history.mapLayout.cells[firstCellIndex]?.styleOverride?.hoverOverride?.[key as keyof CellStyleOverridePure] !== undefined && this.isPropertyCommonToAllCells(key as keyof CellStyleOverridePure, this.map.history.mapLayout.cells[firstCellIndex]?.styleOverride?.hoverOverride?.[key as keyof CellStyleOverridePure], "hover")) {
                if (!this.state.cellStyleChanges.hoverOverride) {
                    this.state.cellStyleChanges.hoverOverride = {};
                }

                // @ts-expect-error
                this.state.cellStyleChanges.hoverOverride[key as keyof CellStyleOverridePure] = this.map.history.mapLayout.cells[cellIndexes[0]]?.styleOverride?.hoverOverride?.[key as keyof CellStyleOverridePure];
            }
            if (this.map.history.mapLayout.cells[firstCellIndex]?.styleOverride?.selectedOverride?.[key as keyof CellStyleOverridePure] !== undefined && this.isPropertyCommonToAllCells(key as keyof CellStyleOverridePure, this.map.history.mapLayout.cells[firstCellIndex]?.styleOverride?.selectedOverride?.[key as keyof CellStyleOverridePure], "selected")) {
                if (!this.state.cellStyleChanges.selectedOverride) {
                    this.state.cellStyleChanges.selectedOverride = {};
                }

                // @ts-expect-error
                this.state.cellStyleChanges.selectedOverride[key as keyof CellStyleOverridePure] = this.map.history.mapLayout.cells[cellIndexes[0]]?.styleOverride?.selectedOverride?.[key as keyof CellStyleOverridePure];
            }
        }

        this.render();
    }

    applyToMap() {
        if (!this.map || !this.state.selectedCells) return;

        const cellIndexes = this.state.selectedCells.indexes;

        const oldCells = [];
        const newCells = [];

        for (let index of cellIndexes) {
            let cell = JSON.parse(JSON.stringify(this.map.history.mapLayout.cells[index]));

            oldCells.push(cell);

            if (cell === null) {
                cell = {
                    type: this.state.selectedType,
                    styleOverride: {
                        ...this.state.cellStyleChanges
                    }
                }
            } else {
                cell.type = this.state.selectedType;
            }

            const oldHoverOverride: CellStyleOverridePure | null = JSON.parse(JSON.stringify(cell.styleOverride.hoverOverride ?? null));
            const oldSelectedOverride: CellStyleOverridePure | null = JSON.parse(JSON.stringify(cell.styleOverride.selectedOverride ?? null));

            cell.styleOverride = { ...cell.styleOverride, ...this.state.cellStyleChanges };

            if (oldHoverOverride) {
                cell.styleOverride.hoverOverride = { ...oldHoverOverride, ...this.state.cellStyleChanges.hoverOverride };
            }

            if (oldSelectedOverride) {
                cell.styleOverride.selectedOverride = { ...oldSelectedOverride, ...this.state.cellStyleChanges.selectedOverride };
            }

            newCells.push(cell);
        }

        this.map.history.swapCells(cellIndexes, oldCells, newCells);

        return this.map.render();
    }

    isPropertyCommonToAllCells(property: keyof CellStyleOverridePure, value: string | number | boolean | undefined, styleState: CellState) {
        if (this.state.selectedCells === null) {
            return false;
        }

        for (let index of this.state.selectedCells.indexes) {
            let cell = this.map.history.mapLayout.cells[index];

            if (cell === null || cell === undefined) {
                return false;
            }

            if (cell.styleOverride === undefined) {
                return false;
            }

            if (styleState === "default" && cell.styleOverride === undefined) {
                return false;
            }

            if (styleState === "hover" && cell.styleOverride.hoverOverride === undefined) {
                return false;
            }

            if (styleState === "selected" && cell.styleOverride.selectedOverride === undefined) {
                return false;
            }

            if (styleState === "default" && cell.styleOverride[property] === value) {
                continue;
            }

            //@ts-expect-error This error is wrong
            if (styleState === "hover" && cell.styleOverride.hoverOverride[property] === value) {
                continue;
            }

            //@ts-expect-error This error is wrong
            if (styleState === "selected" && cell.styleOverride.selectedOverride[property] === value) {
                continue;
            }
        }

        return true;
    }

    renderIfStateChanged() {
        if (!this.ctx || !this.canvas || !this.input) return;

        if (JSON.stringify(this.state) === JSON.stringify(this.lastFrameState)) {
            return;
        }

        this.render();
    }

    render() {
        if (!this.ctx || !this.canvas || !this.input) return;

        this.fpsCounter.tick();
        this.lastFrameState = JSON.parse(JSON.stringify(this.state));

        const collisions: Collision<string>[] = [];

        const paddingX = 10;
        const marginY = 30;

        const inputHeight = 30;
        const inputWidth = this.canvas.width - (paddingX * 2);
        const inputPadding = 5;

        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        this.ctx.fillStyle = "#0F0";
        const fpsTextMeasurements = this.ctx.measureText(this.fpsCounter.frameCount.toString());
        const fpsTextWidth = fpsTextMeasurements.width;
        this.ctx.fillText(this.fpsCounter.frameCount.toString(), this.canvas.width - fpsTextWidth - 10, 20);

        this.ctx.fillStyle = "#FFF";
        this.ctx.font = `20px 'League Spartan'`;
        this.ctx.fillText("Edit Menu", paddingX, 30);

        let lastElementYEnd = 60 + this.scroll.offset;

        const renderLabel = (element: EditMenuElement): void => {
            let label = EDITMENU_LABELS[element.label];

            if (label === undefined) {
                label = "NO LABEL / UNDEFINED"
            }

            this.ctx.fillStyle = "#FFF";
            this.ctx.font = `16px 'League Spartan'`;

            const lines = [""];
            const words = label.split(" ");

            for (const word of words) {
                lines[lines.length - 1] = lines[lines.length - 1] ?? "";

                lines[lines.length - 1] += word + " "

                const currentLine = lines[lines.length - 1] ?? "";

                const textMeasurements = this.ctx.measureText(currentLine.trim());

                if (textMeasurements.width > inputWidth) {
                    lines[lines.length - 1] = currentLine.slice(0, -word.length - 1).trim();

                    lines.push(word + " ")
                }
            }

            for (let line of lines) {
                this.ctx.fillText(line, paddingX, lastElementYEnd);

                const textMeasurements = this.ctx.measureText(line)

                lastElementYEnd += textMeasurements.actualBoundingBoxAscent + textMeasurements.actualBoundingBoxDescent + marginY / 3;
            }

            lastElementYEnd += marginY;
        }

        const renderInput = (element: EditMenuElement & { type: "input" }, ref: string): void => {
            let label = EDITMENU_LABELS[element.label];

            if (label === undefined) {
                label = "NO LABEL / UNDEFINED"
            }

            this.ctx.fillStyle = "#FFF";
            this.ctx.font = `16px 'League Spartan'`;
            this.ctx.fillText(label, paddingX, lastElementYEnd);

            const textMeasurements = this.ctx.measureText(label);

            lastElementYEnd += textMeasurements.actualBoundingBoxAscent + textMeasurements.actualBoundingBoxDescent;

            this.ctx.fillRect(paddingX, lastElementYEnd, inputWidth, inputHeight);

            let cursorMarginX = paddingX + inputPadding;

            let value = this.cellStyleChangesByKey(element.value as keyof CellStyleOverridePure)?.toString() || "";

            if (value && value.length > 0) {
                this.ctx.fillStyle = "#000";
                this.ctx.font = `16px 'League Spartan'`;
                const textMeasurements = this.ctx.measureText(value);
                const textHeight = textMeasurements.actualBoundingBoxAscent + textMeasurements.actualBoundingBoxDescent;

                this.ctx.fillText(value, cursorMarginX, lastElementYEnd + (inputHeight / 2) + (textHeight / 2));

                cursorMarginX += textMeasurements.width;
            }

            if (this.state.selectedInput === ref && this.state.animations.blinkingCursor.lastState === "visible") {
                this.ctx.strokeStyle = "#000";
                this.ctx.beginPath();
                this.ctx.moveTo(cursorMarginX, lastElementYEnd + inputPadding);
                this.ctx.lineTo(cursorMarginX, lastElementYEnd + inputHeight - inputPadding);
                this.ctx.stroke();
            }

            if (this.state.selectedInput !== ref && value === "" && this.isPropertyCommonToAllCells(element.value as keyof CellStyleOverridePure, value, this.state.selectedStyleState)) {
                let valueOfProperty;

                const firstSelectedCellIndex = this.state.selectedCells?.indexes[0];

                if (firstSelectedCellIndex === undefined) {
                    alert("Can't edit this cell due to missing firstSelectedCellIndex during render process");

                    return;
                }

                if (this.state.selectedCells && this.map.history.mapLayout.cells[firstSelectedCellIndex] && this.map.history.mapLayout.cells[firstSelectedCellIndex]?.styleOverride) {
                    if (this.state.selectedStyleState === "default") {
                        valueOfProperty = this.map.history.mapLayout.cells[firstSelectedCellIndex].styleOverride[element.value as keyof CellStyleOverridePure];
                    } else if (this.state.selectedStyleState === "hover") {
                        if (this.state.cellStyleChanges.hoverOverride === undefined) {
                            alert("Can't render this cell in hover state due to missing state.cellStyleChanges.hoverOverride")

                            return;
                        }

                        valueOfProperty = this.state.cellStyleChanges.hoverOverride[element.value as keyof CellStyleOverridePure];
                    } else if (this.state.selectedStyleState === "selected") {
                        if (this.state.cellStyleChanges.selectedOverride === undefined) {
                            alert("Can't render this cell in hover state due to missing state.cellStyleChanges.selectedOverride")

                            return;
                        }

                        valueOfProperty = this.state.cellStyleChanges.selectedOverride[element.value as keyof CellStyleOverridePure];
                    }
                }

                const placeHolder = typeof valueOfProperty === "string" ? valueOfProperty : "";

                this.ctx.fillStyle = "#000";
                this.ctx.globalAlpha = 0.7;
                this.ctx.font = `16px 'League Spartan'`;
                const textMeasurements = this.ctx.measureText(placeHolder);
                const textHeight = textMeasurements.actualBoundingBoxAscent + textMeasurements.actualBoundingBoxDescent;

                this.ctx.fillText(placeHolder, cursorMarginX, lastElementYEnd + (inputHeight / 2) + (textHeight / 2));

                this.ctx.globalAlpha = 1;
            }

            collisions.push({
                x: paddingX,
                y: lastElementYEnd,
                width: inputWidth,
                height: inputHeight,
                reference: ref
            })

            lastElementYEnd += 30 + marginY;
        }

        const renderButton = (element: EditMenuElement & { type: "button" }, ref: string): void => {
            let label = EDITMENU_LABELS[element.label];

            if (label === undefined) {
                label = "NO LABEL / UNDEFINED"
            }

            this.ctx.font = `16px 'League Spartan'`;

            const textWidth = this.ctx.measureText(label).width;
            const buttonWidth = textWidth + (paddingX * 2);

            this.ctx.fillStyle = "#00F";
            this.ctx.fillRect(paddingX, lastElementYEnd, buttonWidth, inputHeight);

            this.ctx.fillStyle = "#FFF";
            this.ctx.fillText(label, paddingX + paddingX, lastElementYEnd + (inputHeight / 2) + 5);

            collisions.push({
                x: paddingX,
                y: lastElementYEnd,
                width: buttonWidth,
                height: inputHeight,
                reference: ref
            });

            lastElementYEnd += inputHeight + marginY;
        }

        const renderHSelect = (element: EditMenuElement & { type: "hselect" }, ref: string): void => {
            let labelTag = "";

            if (element.label === "hslct_edit_state") {
                labelTag = this.state.selectedStyleState;
            } else if (element.label === "hslct_type") {
                labelTag = this.state.selectedType;
            }

            this.ctx.fillStyle = "#F00";
            this.ctx.fillRect(paddingX, lastElementYEnd, inputWidth, inputHeight);
            this.ctx.fillStyle = "#FFF";
            this.ctx.font = `20px 'League Spartan' Bold`;

            const optionLabel = EDITMENU_LABELS[labelTag] || labelTag;

            const textWidth = this.ctx.measureText(optionLabel).width;
            const arrowWidth = this.ctx.measureText("→").width;

            this.ctx.fillText("←", paddingX + 5, lastElementYEnd + (inputHeight / 2) + 5);
            this.ctx.fillText("→", paddingX + inputWidth - 5 - arrowWidth, lastElementYEnd + (inputHeight / 2) + 5);

            this.ctx.fillText(optionLabel, paddingX + ((inputWidth / 2) - (textWidth / 2)), lastElementYEnd + (inputHeight / 2) + 5);

            collisions.push({
                x: paddingX + 5,
                y: lastElementYEnd,
                width: arrowWidth,
                height: inputHeight,
                reference: `${ref}-`
            });

            collisions.push({
                x: paddingX + inputWidth - 5 - arrowWidth,
                y: lastElementYEnd,
                width: arrowWidth,
                height: inputHeight,
                reference: `${ref}+`
            });

            lastElementYEnd += inputHeight + marginY;
        }

        const renderCheckbox = (element: EditMenuElement & { type: "checkbox" }, ref: string): void => {
            let label = EDITMENU_LABELS[element.label];

            if (label === undefined) {
                label = "NO LABEL / UNDEFINED"
            }

            const checkboxWidth = inputHeight;
            const checkboxHeight = inputHeight;

            this.ctx.fillStyle = "#FFF";
            this.ctx.font = `16px 'League Spartan'`;
            this.ctx.fillText(label, paddingX, lastElementYEnd + (inputHeight / 2) + 5);

            const textWidth = this.ctx.measureText(label).width;

            const boxOffsetX = paddingX * 2 + textWidth;

            this.ctx.globalAlpha = 0.5;
            this.ctx.fillStyle = "#000";
            this.ctx.fillRect(boxOffsetX, lastElementYEnd, checkboxWidth, checkboxHeight);
            this.ctx.globalAlpha = 1;

            this.ctx.strokeStyle = "#FFF";
            this.ctx.lineWidth = 0.5;
            this.ctx.strokeRect(boxOffsetX, lastElementYEnd, checkboxWidth, checkboxHeight);

            let value = !!this.cellStyleChangesByKey(element.value as keyof CellStyleOverridePure);

            if (value) {
                this.ctx.fillStyle = "#0FF";
                this.ctx.fillRect(boxOffsetX + 4, lastElementYEnd + 4, checkboxWidth - 8, checkboxHeight - 8);
            }

            collisions.push({
                x: boxOffsetX,
                y: lastElementYEnd,
                width: checkboxWidth,
                height: checkboxHeight,
                reference: ref
            });

            lastElementYEnd += inputHeight + marginY;
        }

        const renderGroupHeader = (element: EditMenuElement & { type: "group" }, i: number): void => {
            let label = EDITMENU_LABELS[element.label];

            if (label === undefined) {
                label = "NO LABEL / UNDEFINED"
            }

            const buttonWidth = this.canvas.width - (paddingX * 2);

            this.ctx.fillStyle = "#2B2B2B";
            this.ctx.fillRect(paddingX, lastElementYEnd, buttonWidth, inputHeight);

            this.ctx.fillStyle = "#FFF";
            this.ctx.font = `16px 'League Spartan'`;
            this.ctx.fillText(label, paddingX * 2, lastElementYEnd + (inputHeight / 2) + 5);

            collisions.push({
                x: paddingX,
                y: lastElementYEnd,
                width: buttonWidth,
                height: inputHeight,
                reference: i.toString()
            });

            lastElementYEnd += inputHeight + marginY;
        }

        for (let i = 0; i < this.elements.length; i++) {
            const element = this.elements[i];

            if (element === undefined) {
                console.error("Cannot render undefined element");

                continue;
            }

            if (element.type === "label") {
                renderLabel(element);
            } else if (element.type === "input") {
                renderInput(element, i.toString());
            } else if (element.type === "button") {
                renderButton(element, i.toString());
            } else if (element.type === "hselect") {
                renderHSelect(element, i.toString());
            } else if (element.type === "checkbox") {
                renderCheckbox(element, i.toString());
            } else if (element.type === "group") {
                renderGroupHeader(element, i);
                if (this.state.openGroups.includes(i)) {
                    let subIndex = 0;
                    for (const subelement of element.elements) {

                        if (subelement.type === "input") {
                            renderInput(subelement, `${i}_${subIndex}`);
                        } else if (subelement.type === "button") {
                            renderButton(subelement, `${i}_${subIndex}`);
                        } else if (subelement.type === "hselect") {
                            renderHSelect(subelement, `${i}_${subIndex}`);
                        } else if (subelement.type === "label") {
                            renderLabel(subelement);
                        } else if (subelement.type === "checkbox") {
                            renderCheckbox(subelement, `${i}_${subIndex}`);
                        }

                        subIndex++;
                    }
                }
            }
        }

        this.scroll.lastFrameHeight = lastElementYEnd - this.scroll.offset;

        this.ctx.fillStyle = "#FFF";
        this.ctx.globalAlpha = 0.1;
        this.ctx.fillRect(this.canvas.width - SCROLLBAR_WIDTH, 0, SCROLLBAR_WIDTH, this.canvas.height);
        this.ctx.globalAlpha = 1;
        this.ctx.fillRect(this.canvas.width - SCROLLBAR_WIDTH, -this.scroll.offset, SCROLLBAR_WIDTH, this.canvas.height * (this.canvas.height / this.scroll.lastFrameHeight));

        this.collisions.registerCollisions(collisions);
    }
}