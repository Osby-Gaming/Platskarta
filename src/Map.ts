import invert from "invert-color";
import CollisionManager from "./CollisionManager";
import { DEFAULT_MAP_BACKGROUND_COLOR, DEFAULT_ZOOM_LEVEL, CELL_SIZE, ZOOM_LEVELS, MAX_ZOOM, DEFAULT_CELL_STYLES, MouseButtons, SVGPaths } from "./data";
import EditMenu from "./EditMenu";
import { Cell, CellStyleOverride, Collision, CopyMode, ExtendedTouch, KeyboardRunReason, LineDirection, MapLayout, MapLayoutInput, MapMode, MapRenderInstruction, MergingInstruction1D } from "./types";
import { EventEmitter, FPSCounter, getHexFromCSSColor } from "./util";
import { sortNumberArray, chunks } from "../util";
import { MapLayoutHistory } from "./MapLayoutHistory";

export default class Map extends EventEmitter<{ save: MapLayoutInput, select: number }> {
    mode: MapMode;
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D | null;

    history: MapLayoutHistory;
    mapWidth: number;
    mapHeight: number;

    minZoom: number;

    camera: {
        x: number;
        y: number;
        zoom: number;
    } = {
            x: 0,
            y: 0,
            zoom: 1,
        }

    private controller: {
        keysPressed: string[];
    } = {
            keysPressed: []
        }

    collisions: CollisionManager<number>;
    editMenu: EditMenu | null = null;

    ongoingTouches: { identifier: number, pageX: number, pageY: number, hasMoved: boolean }[] = [];

    private state: {
        hoveredCell: number
        selectedCells: number[],
        multiSelect: {
            start: { x: number, y: number },
            current: { x: number, y: number },
            selecting: boolean,
            dontSelect: boolean
        },
        copying: {
            cells: (Cell | undefined)[][],
            bounds: [number, number, number, number] | [null, null, null, null]
        }
    } = {
            hoveredCell: -1,
            selectedCells: [],
            multiSelect: {
                start: { x: 0, y: 0 },
                current: { x: 0, y: 0 },
                selecting: false,
                dontSelect: false
            },
            copying: {
                cells: [],
                bounds: [null, null, null, null]
            }
        }

    fpsCounter: FPSCounter = new FPSCounter();

    lastFrame: MapRenderInstruction[][] = [];
    lastFrameTimestamp: number = 0;

    static processInputCells(cells: (Cell | `${number}`)[]): Cell[] {
        const processedCells: Cell[] = [];

        for (const cell of cells) {
            if (typeof cell === "string") {
                const count = parseInt(cell, 10);
                for (let j = 0; j < count; j++) {
                    processedCells.push(null);
                }
            } else {
                processedCells.push(cell);
            }
        }

        return processedCells;
    }

    static inputProcessing(input: MapLayoutInput) {
        const processedObjects: Cell[] = Map.processInputCells(input.cells);

        if (processedObjects.length !== input.x * input.y) {
            throw new Error(`Invalid map layout: expected ${input.x * input.y} cells, got ${processedObjects.length}`);
        }

        return {
            x: input.x,
            y: input.y,
            cells: processedObjects,
            globalOverride: {
                backgroundColor: input.globalOverride?.backgroundColor || DEFAULT_MAP_BACKGROUND_COLOR,
                zoomLevel: input.globalOverride?.zoomLevel || DEFAULT_ZOOM_LEVEL,
                cellStyleOverride: {
                    seat: input.globalOverride?.cellStyleOverride?.seat,
                    aisle: input.globalOverride?.cellStyleOverride?.aisle,
                    wall: input.globalOverride?.cellStyleOverride?.wall,
                    door: input.globalOverride?.cellStyleOverride?.door,
                    custom: input.globalOverride?.cellStyleOverride?.custom
                }
            }
        } as MapLayout;
    }

    constructor(mode: MapMode, canvasId: string, mapLayout: MapLayoutInput, editMenuId?: string, toolbeltId?: string, lockedCells: number[] = []) {
        super();
        this.mode = mode;

        this.history = new MapLayoutHistory(Map.inputProcessing(mapLayout));
        this.mapWidth = mapLayout.x * CELL_SIZE;
        this.mapHeight = mapLayout.y * CELL_SIZE;

        this.camera.zoom = this.history.mapLayout.globalOverride.zoomLevel;

        this.canvas = document.getElementById(canvasId) as HTMLCanvasElement;
        this.canvas.width = this.canvas.offsetWidth;
        this.canvas.height = this.canvas.offsetHeight;

        this.canvas.oncontextmenu = () => {
            return false;
        }

        this.ctx = this.canvas.getContext("2d", { alpha: false });

        this.collisions = new CollisionManager(this);

        if (this.mode === "edit") {
            if (!editMenuId) {
                throw new Error("Edit mode requires an edit menu ID to be provided.");
            }

            const el = document.getElementById(editMenuId);

            if (!el) {
                throw new Error(`Edit menu element with ID ${editMenuId} not found.`);
            }

            el.style.display = "block";

            this.editMenu = new EditMenu(this, editMenuId, lockedCells, toolbeltId || '');
        }

        this.canvas.addEventListener("wheel", (event) => {
            event.preventDefault();

            if (this.state.multiSelect.selecting) {
                return;
            }

            if (event.deltaY > 0) {
                this.zoomToLevel(ZOOM_LEVELS.findLast((level, _) => {
                    if (level < this.camera.zoom) {
                        return true;
                    }

                    return false;
                }) ?? this.minZoom, event.pageX, event.pageY)
            } else {
                this.zoomToLevel(ZOOM_LEVELS.find((level, _) => {
                    if (level > this.camera.zoom) {
                        return true;
                    }
                    return false;
                }) ?? MAX_ZOOM, event.pageX, event.pageY)
            }
        });

        this.canvas.addEventListener("keydown", (event) => {
            const adjustedKey = event.key.toLowerCase();

            if (this.controller.keysPressed.includes(adjustedKey)) return;

            this.controller.keysPressed.push(adjustedKey);

            this.runKeyboardControls(KeyboardRunReason.KeyDown);
        });

        this.canvas.addEventListener("keyup", (event) => {
            const index = this.controller.keysPressed.indexOf(event.key.toLowerCase());

            if (index > -1) {
                this.controller.keysPressed.splice(index, 1);
            }

            this.runKeyboardControls(KeyboardRunReason.KeyUp);
        })

        setInterval(() => {
            this.runKeyboardControls(KeyboardRunReason.Interval);
        }, 32);

        this.canvas.addEventListener("touchstart", this.handleTouchStartDecorator(() => this));
        this.canvas.addEventListener("touchend", this.handleTouchEndDecorator(() => this));
        this.canvas.addEventListener("touchcancel", this.handleTouchCancelDecorator(() => this));
        this.canvas.addEventListener("touchmove", this.handleTouchMoveDecorator(() => this));

        this.collisions.addEventListener("hover", (collision: Collision<number>) => {
            if (this.state.hoveredCell === collision.reference) {
                return;
            };

            this.state.hoveredCell = collision.reference;

            if (collision.reference === -1) {
                this.setCursor("grab");
            } else {
                this.setCursor("pointer");
            }

            this.render();
        });

        this.collisions.addEventListener("click", (collision: Collision<number>, mouseButtonsDown) => {
            if (!mouseButtonsDown || !mouseButtonsDown.includes(MouseButtons.LEFT)) {
                return;
            }

            this.setCursor("pointer");

            if (this.mode === "edit" && this.controller.keysPressed.includes("shift")) {
                if (this.state.selectedCells.includes(collision.reference)) {
                    this.state.selectedCells = this.state.selectedCells.filter(cell => cell !== collision.reference);
                } else {
                    this.state.selectedCells.push(collision.reference);
                }
            } else {
                if (this.state.selectedCells.includes(collision.reference)) {
                    this.state.selectedCells = [];

                    this.emit("select", -collision.reference);
                } else {
                    this.state.selectedCells = [collision.reference];

                    this.emit("select", collision.reference);
                }
            }

            if (this.mode === "edit") {
                this.editMenu?.selectCells(this.state.selectedCells);
            }

            this.render();
        })

        this.collisions.addEventListener("drag", (diffX: number, diffY: number, mouseButtons: MouseButtons[]) => {
            if (this.mode === "no-interact") {
                return;
            }

            if (mouseButtons.includes(MouseButtons.RIGHT)) {
                if (this.mode === "edit") {
                    if (!this.state.multiSelect.dontSelect) {
                        if (!this.state.multiSelect.selecting) {
                            this.state.multiSelect.selecting = true;
                            this.state.multiSelect.start.x = this.collisions.drag.start.x;
                            this.state.multiSelect.start.y = this.collisions.drag.start.y;
                            this.state.multiSelect.current.x = this.state.multiSelect.start.x;
                            this.state.multiSelect.current.y = this.state.multiSelect.start.y;
                        } else {
                            this.state.multiSelect.current.x += diffX;
                            this.state.multiSelect.current.y += diffY;
                        }

                        this.state.multiSelect.selecting = true;

                        this.render();

                        return;
                    }

                    if (this.state.multiSelect.selecting) {
                        this.stopMultiSelect();
                    }
                }
            } else if (mouseButtons.includes(MouseButtons.LEFT)) {
                this.state.multiSelect.dontSelect = true;

                this.camera.x -= diffX / this.camera.zoom;
                this.camera.y -= diffY / this.camera.zoom;

                this.setCursor("grabbing");

                this.keepCameraConstraintsAndRender();
            }
        });

        this.collisions.addEventListener("dragend", () => {
            if (this.mode === "no-interact") {
                return;
            }

            if (this.state.multiSelect.selecting) {
                this.stopMultiSelect();
            } else {
                this.state.multiSelect.dontSelect = false;
            }

            if (this.state.hoveredCell === -1) {
                this.setCursor("grab");
            } else {
                this.setCursor("pointer");
            }

            this.render();
        });

        let [minX, maxX, minY, maxY] = this.getCellBounds();

        if (this.mode === "edit" || this.mode === "preview") {
            this.minZoom = Math.max(this.canvas.height / this.mapHeight, this.canvas.width / this.mapWidth) + 0.1;
        } else {
            this.minZoom = Math.max(this.canvas.height / (maxY - minY), this.canvas.width / (maxX - minX)) + 0.1;
        }

        this.centerCamera();
    }

    switchLayout(mapLayout: MapLayoutInput) {
        this.history = new MapLayoutHistory(Map.inputProcessing(mapLayout));
        this.mapWidth = mapLayout.x * CELL_SIZE;
        this.mapHeight = mapLayout.y * CELL_SIZE;

        this.render();
    }

    stopMultiSelect() {
        if (this.mode !== "edit") {
            return;
        }

        this.state.multiSelect.selecting = false;
        this.state.multiSelect.dontSelect = false;

        // find all cells in the given multicelect rectangle by using the collisions manager
        const startX = Math.min(this.state.multiSelect.start.x, this.state.multiSelect.current.x);
        const startY = Math.min(this.state.multiSelect.start.y, this.state.multiSelect.current.y);
        const endX = Math.max(this.state.multiSelect.start.x, this.state.multiSelect.current.x);
        const endY = Math.max(this.state.multiSelect.start.y, this.state.multiSelect.current.y);

        const cellsInRectangle: number[] = [];
        for (let collision of this.collisions.collisions) {
            if (collision.x + collision.width >= startX && collision.y + collision.height >= startY
                && collision.x <= endX && collision.y <= endY) {
                cellsInRectangle.push(collision.reference);
            }
        }

        this.state.selectedCells = Array.from(new Set([...this.state.selectedCells, ...cellsInRectangle]));

        this.state.multiSelect.start = { x: 0, y: 0 };
        this.state.multiSelect.current = { x: 0, y: 0 };

        this.editMenu?.selectCells(this.state.selectedCells);

        this.render();
    }

    handleTouchStartDecorator(mapGetter: () => Map) {
        return (event: TouchEvent) => {
            event.preventDefault();

            const touches = event.changedTouches;

            for (let i = 0; i < touches.length; i++) {
                mapGetter().ongoingTouches.push(mapGetter().touchToExtendedTouch(touches[i]));
            }
        }
    }

    handleTouchEndDecorator(mapGetter: () => Map) {
        return (event: TouchEvent) => {
            event.preventDefault();

            const touches = event.changedTouches;

            for (let i = 0; i < touches.length; i++) {
                const idx = mapGetter().ongoingTouchIndexById(touches[i].identifier);

                if (idx >= 0) {
                    const touch = mapGetter().ongoingTouches.splice(idx, 1)[0];

                    if (!touch.hasMoved) {
                        mapGetter().collisions.leftClick(touch.pageX, touch.pageY);
                    }
                }
            }
        }
    }

    handleTouchCancelDecorator = this.handleTouchEndDecorator;

    handleTouchMoveDecorator(mapGetter: () => Map) {
        return (event: TouchEvent) => {
            event.preventDefault();
            const touches = event.changedTouches;

            const mapContext = mapGetter();

            if (touches.length !== 2) {
                const idx = mapContext.ongoingTouchIndexById(touches[0].identifier);

                if (idx >= 0) {
                    const touch = mapContext.ongoingTouches[idx];
                    const dx = touches[0].pageX - touch.pageX;
                    const dy = touches[0].pageY - touch.pageY;

                    mapContext.camera.x -= dx / mapContext.camera.zoom;
                    mapContext.camera.y -= dy / mapContext.camera.zoom;

                    mapContext.ongoingTouches.splice(idx, 1, { identifier: touches[0].identifier, hasMoved: true, pageX: touches[0].pageX, pageY: touches[0].pageY });
                }
            }

            if (touches.length === 2) {
                const idx1 = mapContext.ongoingTouchIndexById(touches[0].identifier);
                const idx2 = mapContext.ongoingTouchIndexById(touches[1].identifier);

                if (idx1 >= 0 && idx2 >= 0) {
                    const touch1 = mapContext.ongoingTouches[idx1];
                    const touch2 = mapContext.ongoingTouches[idx2];

                    const pox1 = touch1.pageX;
                    const poy1 = touch1.pageY;
                    const pox2 = touch2.pageX;
                    const poy2 = touch2.pageY;

                    const distanceBefore = Math.sqrt(Math.pow(pox2 - pox1, 2) + Math.pow(poy2 - poy1, 2));

                    const touch1n = touches[0];
                    const touch2n = touches[1];

                    const pnx1 = touch1n.pageX;
                    const pny1 = touch1n.pageY;
                    const pnx2 = touch2n.pageX;
                    const pny2 = touch2n.pageY;

                    const distanceAfter = Math.sqrt(Math.pow(pnx2 - pnx1, 2) + Math.pow(pny2 - pny1, 2));

                    const middleBetweenTouchesX = (pox1 + pox2) / 2;
                    const middleBetweenTouchesY = (poy1 + poy2) / 2;

                    const zoomThrottleConstant = 200;
                    const zoomThrottle = zoomThrottleConstant / mapContext.camera.zoom;

                    if (distanceBefore > distanceAfter) {
                        this.zoomToLevel(this.camera.zoom-(distanceBefore / zoomThrottle - distanceAfter / zoomThrottle), middleBetweenTouchesX, middleBetweenTouchesY)
                    } else {
                        this.zoomToLevel(this.camera.zoom+(distanceAfter / zoomThrottle - distanceBefore / zoomThrottle), middleBetweenTouchesX, middleBetweenTouchesY)
                    }

                    const hasFirstMoved = touch1.pageX !== touch1n.pageX || touch1.pageY !== touch1n.pageY;
                    const hasSecondMoved = touch2.pageX !== touch2n.pageX || touch2.pageY !== touch2n.pageY;

                    mapContext.ongoingTouches.splice(idx1, 1, { identifier: touch1n.identifier, hasMoved: (touch1.hasMoved ? true : hasFirstMoved), pageX: touch1n.pageX, pageY: touch1n.pageY });
                    mapContext.ongoingTouches.splice(idx2, 1, { identifier: touch2n.identifier, hasMoved: (touch2.hasMoved ? true : hasSecondMoved), pageX: touch2n.pageX, pageY: touch2n.pageY });
                }
            }

            mapContext.keepCameraConstraintsAndRender();
        }
    }

    runKeyboardControls(reason: KeyboardRunReason) {
        if (this.controller.keysPressed.length > 0) {
            if (reason === KeyboardRunReason.KeyDown) {
                if (this.controller.keysPressed.includes("control")) {
                    if (this.mode === "edit") {
                        if (this.state.selectedCells.length > 0) {
                            if (this.controller.keysPressed.includes("c")) {
                                this.copyCellsBySelection();
                            } else if (this.controller.keysPressed.includes("x")) {
                                this.cutCellsBySelection();
                            } else if (this.controller.keysPressed.includes("v")) {
                                this.pasteCells();
                            }
                        }

                        if (this.controller.keysPressed.includes("z")) {
                            if (this.controller.keysPressed.includes("shift")) {
                                this.history.redo();
                            } else {
                                this.history.undo();
                            }

                            this.render();
                        }
                    }
                }
            }
            if (reason === KeyboardRunReason.Interval) {
                let render = false;

                let movementMultiplier = this.controller.keysPressed.includes("shift") ? 3 : 1;

                if ((this.controller.keysPressed.includes("arrowup") || this.controller.keysPressed.includes("arrowdown"))
                    && (this.controller.keysPressed.includes("arrowleft") || this.controller.keysPressed.includes("arrowright"))
                    && !(this.controller.keysPressed.includes("arrowup") && this.controller.keysPressed.includes("arrowdown"))
                    && !(this.controller.keysPressed.includes("arrowleft") && this.controller.keysPressed.includes("arrowright"))) {
                    movementMultiplier /= Math.sqrt(2); // Diagonal movement adjustment when using only two arrow keys that make a diagonal, based on Pythagorean theorem
                }

                if (this.controller.keysPressed.includes("arrowup")) {
                    this.camera.y -= 10 * movementMultiplier;

                    render = true;
                }
                if (this.controller.keysPressed.includes("arrowdown")) {
                    this.camera.y += 10 * movementMultiplier;

                    render = true;
                }
                if (this.controller.keysPressed.includes("arrowleft")) {
                    this.camera.x -= 10 * movementMultiplier;

                    render = true;
                }
                if (this.controller.keysPressed.includes("arrowright")) {
                    this.camera.x += 10 * movementMultiplier;

                    render = true;
                }

                if (render) {
                    this.keepCameraConstraintsAndRender();
                }
            }
        }
    }

    copyCellsBySelection() {
        if (this.mode !== "edit") {
            console.error("Tried to copy cells while not in edit mode");
            return false;
        }

        const selection = this.state.selectedCells;

        const rows: (Cell | undefined)[][] = [];

        const bounds = this.getSelectionCellBoundsAsCoordinates();

        if (bounds[0] === null) {
            console.error("Couldnt get bounds while trying to copy cells")
            return false;
        }

        for (let y = bounds[2]; y <= bounds[3]; y++) {
            const row: (Cell | undefined)[] = [];

            for (let x = bounds[0]; x <= bounds[1]; x++) {
                const cellIndex = this.coordinatesToCellIndex(x, y);

                if (selection.includes(cellIndex)) {
                    row.push(this.history.mapLayout.cells[cellIndex]);
                } else {
                    row.push(undefined);
                }
            }

            rows.push(row);
        }

        this.state.copying.cells = structuredClone(rows);
        this.state.copying.bounds = bounds;

        return true;
    }

    cutCellsBySelection() {
        const copy = this.copyCellsBySelection();

        if (!copy) {
            return false;
        }

        const selection = this.state.selectedCells;

        const selectionBounds = this.state.copying.bounds;

        if (selectionBounds[0] === null) {
            console.error("Couldnt get bounds while trying to cut cells")

            return false;
        }

        const indexes: number[] = [];
        const from: Cell[] = [];
        const to: Cell[] = [];

        for (let y = selectionBounds[2]; y <= selectionBounds[3]; y++) {
            for (let x = selectionBounds[0]; x <= selectionBounds[1]; x++) {
                const cellIndex = this.coordinatesToCellIndex(x, y);

                if (!selection.includes(cellIndex)) {
                    continue;
                }

                indexes.push(cellIndex);
                from.push(this.history.mapLayout.cells[cellIndex]);
                to.push(null);
            }
        }

        this.history.swapCells(indexes, from, to);

        this.render();

        return true;
    }

    pasteCells() {
        if (this.mode !== "edit") {
            console.error("Tried to paste cells while not in edit mode");
            return false;
        }

        const firstCellIndex = this.getFirstCellIndexOfSelection();

        if (firstCellIndex === null) {
            console.error("Tried to paste cells but first cell index was null");

            return false;
        }

        const startingPoint = this.getCoordinatesOfCell(firstCellIndex);

        if (startingPoint[0] === null) {
            console.error("Tried to paste cells but starting point was null");

            return false;
        }

        const rows = this.state.copying.cells;
        const bounds = this.state.copying.bounds;

        if (bounds[0] === null) {
            console.error("Tried to paste cells but bounds were null");

            return false;
        }

        const endX = startingPoint[0] + bounds[1] - bounds[0] + 1;
        const endY = startingPoint[1] + bounds[3] - bounds[2] + 1;

        const indices: number[] = [];
        const from: Cell[] = [];
        const to: Cell[] = [];

        for (let y = startingPoint[1]; y < endY; y++) {
            const row = rows[y - startingPoint[1]];
            
            for (let x = startingPoint[0]; x < endX; x++) {
                const cellData = row[x - startingPoint[0]];
                const cellIndex = this.coordinatesToCellIndex(x, y);

                if (cellData === undefined) {
                    continue;
                }

                indices.push(cellIndex);
                from.push(this.history.mapLayout.cells[cellIndex]);
                to.push(cellData);
            }
        }

        this.history.swapCells(indices, from, to);

        this.render();

        return true;
    }
    
    zoomToLevel(level: number, mouseX?: number, mouseY?: number) {
        const currentZoom = this.camera.zoom;
        let zoomTo = level;
        
        if (zoomTo < this.minZoom) {
            zoomTo = this.minZoom;
        }

        if (zoomTo > MAX_ZOOM) {
            zoomTo = MAX_ZOOM;
        }

        const zoomDiff = zoomTo - currentZoom;

        if (zoomDiff === 0) {
            return;
        }

        // Centers the camera after zooming

        // const originalWidth = this.mapWidth / this.camera.zoom;
        // const newWidth = this.mapWidth / zoomTo;

        // const widthDiff = newWidth - originalWidth;
        // const moveXBy = widthDiff / 2;

        // this.camera.x -= moveXBy;

        // const originalHeight = this.mapHeight / this.camera.zoom;
        // const newHeight = this.mapHeight / zoomTo;

        // const heightDiff = newHeight - originalHeight;
        // const moveYBy = heightDiff / 2;

        // this.camera.y -= moveYBy;
        

        if (mouseX !== undefined && mouseY !== undefined) {
            // keep mouse location in the same place
            const oldMouseXOnMap = this.camera.x + mouseX / this.camera.zoom;
            const oldMouseYOnMap = this.camera.y + mouseY / this.camera.zoom;

            const newMouseXOnMap = this.camera.x + mouseX / zoomTo;
            const newMouseYOnMap = this.camera.y + mouseY / zoomTo;

            let diffX = Math.abs(newMouseXOnMap - oldMouseXOnMap);
            let diffY = Math.abs(newMouseYOnMap - oldMouseYOnMap);

            if (zoomDiff < 0) {
                diffX *= -1;
                diffY *= -1;
            }

            this.camera.x += diffX;
            this.camera.y += diffY;
        }

        this.camera.zoom = zoomTo;

        this.keepCameraConstraintsAndRender(true);
    }

    getFirstCellIndexOfSelection(): number | null {
        const selection = this.state.selectedCells;

        if (selection.length === 0) {
            console.error("Tried to get first cell index of selection but selection was empty");

            return null;
        }

        const firstCellIndex = selection.sort((a, b) => a - b)[0];

        return firstCellIndex;
    }

    getCoordinatesOfCell(cellIndex: number): [number, number] | [null, null] {
        const cellRows = [...chunks(this.history.mapLayout.cells, this.history.mapLayout.x)];
        let rowPos = 0;

        for (const row of cellRows) {
            for (let pos = 0; pos < row.length; pos++) {
                if (cellIndex === rowPos * this.history.mapLayout.x + pos) {
                    return [pos, rowPos];
                }
            }

            rowPos++;
        }

        return [null, null];
    }

    coordinatesToCellIndex(x: number, y: number): number {
        return y * this.history.mapLayout.x + x;
    }

    getSelectionCellBoundsAsCoordinates(): [number, number, number, number] | [null, null, null, null] {
        const cellRows = [...chunks(this.history.mapLayout.cells, this.history.mapLayout.x)];
        const selection = this.state.selectedCells;

        if (selection.length === 0) {
            return [null, null, null, null];
        }

        let minX = this.history.mapLayout.x;
        let maxX = 0;
        let minY = this.history.mapLayout.y;
        let maxY = 0;

        let rowPos = 0;

        for (const row of cellRows) {
            let pos = -1;

            for (const cell of row) {
                pos++;

                if (!selection.includes(this.coordinatesToCellIndex(pos, rowPos))) {
                    continue;
                }

                if (pos < minX) {
                    minX = pos;
                }

                if (pos > maxX) {
                    maxX = pos;
                }

                if (rowPos < minY) {
                    minY = rowPos;
                }
                if (rowPos > maxY) {
                    maxY = rowPos;
                }
            }

            rowPos++;
        }

        return [minX, maxX, minY, maxY];
    }

    getCellBounds() {
        const cellRows = [...chunks(this.history.mapLayout.cells, this.history.mapLayout.x)];

        let minX = this.history.mapLayout.x;
        let maxX = 0;
        let minY = this.history.mapLayout.y;
        let maxY = 0;

        let rowPos = 0;

        for (const row of cellRows) {
            let pos = 0;

            for (const cell of row) {
                if (cell === null) {
                    pos++;
                    continue;
                }

                if (pos < minX) {
                    minX = pos;
                }
                if (pos > maxX) {
                    maxX = pos;
                }

                if (rowPos < minY) {
                    minY = rowPos;
                }
                if (rowPos > maxY) {
                    maxY = rowPos;
                }

                pos++;
            }

            rowPos++;
        }

        return [minX * CELL_SIZE, (maxX * CELL_SIZE + CELL_SIZE), minY * CELL_SIZE, ((maxY * CELL_SIZE) + CELL_SIZE)];
    }

    centerCamera() {
        this.keepCameraConstraintsAndRender();

        let [minX, maxX, minY, maxY] = this.getCellBounds();

        this.camera.x = ((maxX + minX) / 3);
        this.camera.y = ((maxY + minY) / 2) - this.mapHeight / 2;

        this.keepCameraConstraintsAndRender(true);
    }

    cameraPositionToCanvas(zoomLevel: number) {
        return [this.camera.x * zoomLevel, this.camera.y * zoomLevel];
    }
    
    canvasPositionToCamera(x: number, y: number, zoomLevel: number) {
        return [x / zoomLevel, y / zoomLevel];
    }

    keepCameraConstraintsAndRender(force = false) {
        let [minX, maxX, minY, maxY] = this.getCellBounds();

        if (this.mode === "edit" || this.mode === "preview") {
            minX = -this.mapWidth / 2;
            maxX = this.mapWidth * 1.5;
            minY = -this.mapHeight / 2;
            maxY = this.mapHeight * 1.5;
        } else {
            minX -= (maxX - minX) / 4;
            maxX += (maxX - minX) / 4;
            minY -= (maxY - minY) / 4;
            maxY += (maxY - minY) / 4;
        }

        if (this.camera.x < minX) {
            this.camera.x = minX;
        } else if (this.camera.x > maxX - (this.canvas.width / this.camera.zoom)) {
            this.camera.x = maxX - (this.canvas.width / this.camera.zoom);
        }

        if (this.camera.y < minY) {
            this.camera.y = minY;
        } else if (this.camera.y > maxY - (this.canvas.height / this.camera.zoom)) {
            this.camera.y = maxY - (this.canvas.height / this.camera.zoom);
        }

        if (this.camera.zoom < this.minZoom) {
            this.camera.zoom = this.minZoom;
        } if (this.camera.zoom > ZOOM_LEVELS[ZOOM_LEVELS.length - 1]) {
            this.camera.zoom = ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
        }

        this.render(force);
    }

    render(force = false) {
        const { mapLayout } = this.history;
        const collisions: Collision<number>[] = [];
        const layers: MapRenderInstruction[][] = [
            [], // Cell layer
            [], // Border layer
            [],  // Text layer
            [] // Overlay layer
        ];

        if (!this.ctx) return;

        if (!force && this.lastFrameTimestamp + 1000 / 60 > performance.now()) {
            return;
        }

        const renderedCellSize = CELL_SIZE * this.camera.zoom;
        const columnsAmount = mapLayout.x;
        const rowsAmount = mapLayout.y;

        const zoomAdjustedCameraXPos = this.camera.x * this.camera.zoom;
        const zoomAdjustedCameraYPos = this.camera.y * this.camera.zoom;

        const visibleWindowTolerance = {
            x: this.canvas.width * this.camera.zoom + (renderedCellSize * 2),
            y: this.canvas.height * this.camera.zoom + (renderedCellSize * 2)
        };

        if (this.mode === "edit") {
            if (this.state.multiSelect.selecting) {
                const startX = this.state.multiSelect.start.x;
                const startY = this.state.multiSelect.start.y;
                const currentX = this.state.multiSelect.current.x;
                const currentY = this.state.multiSelect.current.y;

                let x;
                let y;
                let width;
                let height;

                if (currentX < startX) {
                    x = currentX;
                    width = startX - currentX;
                } else {
                    x = startX;
                    width = currentX - startX;
                }

                if (currentY < startY) {
                    y = currentY;
                    height = startY - currentY;
                } else {
                    y = startY;
                    height = currentY - startY;
                }

                layers[3].push({
                    type: "fillrect",
                    x,
                    y,
                    width,
                    height,
                    color: "rgba(0, 128, 255, 0.5)",
                    opacity: 0.8
                });
            }
            layers[0].push({
                type: "strokerect",
                x: -(renderedCellSize) - zoomAdjustedCameraXPos,
                y: -(renderedCellSize) - zoomAdjustedCameraYPos,
                width: (columnsAmount + 2) * renderedCellSize,
                height: (rowsAmount + 2) * renderedCellSize,
                color: "#0FF",
                lineWidth: 0.5 * this.camera.zoom,
                opacity: 1
            })

            for (let x = 1; x < (columnsAmount + 2); x++) {
                const xPos = -(renderedCellSize) + x * renderedCellSize - zoomAdjustedCameraXPos;
                const yPos = -(renderedCellSize) - zoomAdjustedCameraYPos;

                layers[0].push({
                    type: "strokerect",
                    x: xPos,
                    y: yPos + renderedCellSize,
                    width: 1,
                    height: rowsAmount * renderedCellSize,
                    color: "#CCC",
                    lineWidth: 1 * this.camera.zoom,
                    opacity: 0.4
                })
            }

            for (let y = 0; y < (rowsAmount + 1); y++) {
                const xPos = -(renderedCellSize) - zoomAdjustedCameraXPos;
                const yPos = -(renderedCellSize) + y * renderedCellSize - zoomAdjustedCameraYPos;

                layers[0].push({
                    type: "strokerect",
                    x: xPos + renderedCellSize,
                    y: yPos + renderedCellSize,
                    width: columnsAmount * renderedCellSize,
                    height: 1,
                    color: "#CCC",
                    lineWidth: 1 * this.camera.zoom,
                    opacity: 0.4
                })
            }
        }

        for (let y = 0; y < (rowsAmount); y++) {
            this.ctx.globalAlpha = 1;

            for (let x = 0; x < columnsAmount; x++) {
                this.ctx.globalAlpha = 1;
                const cellIndex = y * columnsAmount + x;
                const cell = mapLayout.cells[cellIndex];

                if (!cell) {
                    if (this.mode === "edit") {
                        const xPos = x * renderedCellSize - zoomAdjustedCameraXPos;
                        const yPos = y * renderedCellSize - zoomAdjustedCameraYPos;

                        collisions.push({
                            x: xPos,
                            y: yPos,
                            width: renderedCellSize,
                            height: renderedCellSize,
                            reference: cellIndex
                        });

                        let backgroundColor;

                        if (this.state.selectedCells.includes(cellIndex)) {
                            backgroundColor = "lightgreen";
                        } else if (this.state.hoveredCell === cellIndex) {
                            backgroundColor = "lightblue";
                        }

                        if (backgroundColor) {
                            layers[0].push({
                                type: "fillrect",
                                x: xPos,
                                y: yPos,
                                width: renderedCellSize,
                                height: renderedCellSize,
                                color: backgroundColor,
                                opacity: 0.4
                            });
                        }
                    }

                    continue;
                };

                const { backgroundColor, borderColor, borderWidth, text, opacity, textFont, textSize, textColor, textOpacity, textWeight, textTranslateX, textTranslateY, textStrokeColor, textStrokeLineWidth, textRotationDegrees, borderTop, borderBottom, borderLeft, borderRight } = this.getCellStyle(cell, this.state.hoveredCell === cellIndex, this.state.selectedCells.includes(cellIndex));

                const xPos = x * renderedCellSize - zoomAdjustedCameraXPos;
                const yPos = y * renderedCellSize - zoomAdjustedCameraYPos;

                // Check if the cell is within the visible window adjusted for zoom
                if (xPos + renderedCellSize < -visibleWindowTolerance.x || xPos > this.canvas.width + visibleWindowTolerance.x ||
                    yPos + renderedCellSize < -visibleWindowTolerance.y || yPos > this.canvas.height + visibleWindowTolerance.y) {
                    continue;
                }

                if (this.mode !== "view" || (this.mode === "view" && cell.type === "seat")) {
                    collisions.push({
                        x: xPos,
                        y: yPos,
                        width: renderedCellSize,
                        height: renderedCellSize,
                        reference: cellIndex
                    });
                }

                const willDrawAnyBorder = borderWidth !== 0 && (borderTop || borderBottom || borderLeft || borderRight);

                if (willDrawAnyBorder) {
                    if (borderWidth !== 0 && borderTop && borderBottom && borderLeft && borderRight) {
                        layers[1].push({
                            type: "strokerect",
                            x: xPos,
                            y: yPos,
                            width: renderedCellSize,
                            height: renderedCellSize,
                            color: borderColor,
                            lineWidth: borderWidth * this.camera.zoom,
                            opacity: opacity
                        })
                    } else {
                        // This is if the border is on less than four sides of the cell
                        if (borderTop) {
                            layers[1].push({
                                type: "line",
                                x: xPos,
                                y: yPos,
                                xTo: xPos + renderedCellSize,
                                yTo: yPos,
                                color: borderColor,
                                lineWidth: borderWidth * this.camera.zoom,
                                opacity: opacity
                            });
                        } else {
                            // This stroke reduces visible anti-aliasing when no border is drawn
                            layers[0].push({
                                type: "line",
                                x: xPos,
                                y: yPos,
                                xTo: xPos + renderedCellSize,
                                yTo: yPos,
                                color: backgroundColor,
                                lineWidth: 1 * this.camera.zoom,
                                opacity: opacity
                            })
                        }
                        if (borderBottom) {
                            layers[1].push({
                                type: "line",
                                x: xPos,
                                y: yPos + renderedCellSize,
                                xTo: xPos + renderedCellSize,
                                yTo: yPos + renderedCellSize,
                                color: borderColor,
                                lineWidth: borderWidth * this.camera.zoom,
                                opacity: opacity
                            });
                        } else {
                            // This stroke reduces visible anti-aliasing when no border is drawn
                            layers[0].push({
                                type: "line",
                                x: xPos,
                                y: yPos + renderedCellSize,
                                xTo: xPos + renderedCellSize,
                                yTo: yPos + renderedCellSize,
                                color: backgroundColor,
                                lineWidth: 1 * this.camera.zoom,
                                opacity: opacity
                            })
                        }
                        if (borderLeft) {
                            layers[1].push({
                                type: "line",
                                x: xPos,
                                y: yPos,
                                xTo: xPos,
                                yTo: yPos + renderedCellSize,
                                color: borderColor,
                                lineWidth: borderWidth * this.camera.zoom,
                                opacity: opacity
                            });
                        } else {
                            // This stroke reduces visible anti-aliasing when no border is drawn
                            layers[0].push({
                                type: "line",
                                x: xPos,
                                y: yPos,
                                xTo: xPos,
                                yTo: yPos + renderedCellSize,
                                color: backgroundColor,
                                lineWidth: 1 * this.camera.zoom,
                                opacity: opacity
                            })
                        }
                        if (borderRight) {
                            layers[1].push({
                                type: "line",
                                x: xPos + renderedCellSize,
                                y: yPos,
                                xTo: xPos + renderedCellSize,
                                yTo: yPos + renderedCellSize,
                                color: borderColor,
                                lineWidth: borderWidth * this.camera.zoom,
                                opacity: opacity
                            });
                        } else {
                            // This stroke reduces visible anti-aliasing when no border is drawn
                            layers[0].push({
                                type: "line",
                                x: xPos + renderedCellSize,
                                y: yPos,
                                xTo: xPos + renderedCellSize,
                                yTo: yPos + renderedCellSize,
                                color: backgroundColor,
                                lineWidth: 1 * this.camera.zoom,
                                opacity: opacity
                            })
                        }
                    }
                } else {
                    // This stroke reduces visible anti-aliasing when no border is drawn
                    layers[0].push({
                        type: "strokerect",
                        x: xPos,
                        y: yPos,
                        width: renderedCellSize,
                        height: renderedCellSize,
                        color: backgroundColor,
                        lineWidth: 1 * this.camera.zoom,
                        opacity: opacity
                    })
                }

                layers[0].push({
                    type: "fillrect",
                    x: xPos,
                    y: yPos,
                    width: renderedCellSize,
                    height: renderedCellSize,
                    color: backgroundColor,
                    opacity: opacity
                })

                if (this.mode === "edit" && this.state.selectedCells.includes(cellIndex)) {
                    layers[3].push({
                        type: "fillrect",
                        x: xPos,
                        y: yPos,
                        width: renderedCellSize,
                        height: renderedCellSize,
                        color: "rgba(0,0,255)",
                        opacity: 0.2
                    })
                }

                if (text) {
                    this.ctx.font = `${textWeight} ${textSize * this.camera.zoom}px ${textFont}`
                    const textMeasurements = this.ctx.measureText(text);
                    const textWidth = textMeasurements.actualBoundingBoxRight - textMeasurements.actualBoundingBoxLeft;
                    const textHeight = textMeasurements.actualBoundingBoxAscent + textMeasurements.actualBoundingBoxDescent;
                    const textXPos = xPos + (renderedCellSize / 2) - (textWidth / 2);
                    const textYPos = yPos + (renderedCellSize / 2) + (textHeight / 2);

                    layers[2].push({
                        type: "text",
                        x: textXPos + (textTranslateX * this.camera.zoom),
                        y: textYPos + (textTranslateY * this.camera.zoom),
                        text: text,
                        font: this.ctx.font,
                        color: textColor,
                        opacity: textOpacity,
                        dimensions: [textWidth, textHeight],
                        rotationDegrees: textRotationDegrees
                    });

                    if (textStrokeColor && textStrokeLineWidth) {
                        layers[2].push({
                            type: "textstroke",
                            x: textXPos + (textTranslateX * this.camera.zoom),
                            y: textYPos + (textTranslateY * this.camera.zoom),
                            text: text,
                            font: this.ctx.font,
                            color: textStrokeColor,
                            opacity: textOpacity,
                            dimensions: [textWidth, textHeight],
                            lineWidth: textStrokeLineWidth * this.camera.zoom,
                            rotationDegrees: textRotationDegrees
                        });
                    }
                }
            }
        }

        // // 1D merging of lines and rectangles
        // let layerIndex = -1;
        // for (let layer of layers) {
        //     layerIndex++;

        //     const mergingInstructions1D: MergingInstruction1D[] = [];

        //     let instructionIndex = -1;
        //     for (let instruction of layer) {
        //         instructionIndex++;

        //         if (instruction.type === "line") {
        //             let lineDirection: LineDirection;

        //             if (instruction.xTo > instruction.x && instruction.yTo > instruction.y) {
        //                 // Is diagonal, not optimizing
        //                 continue;
        //             }

        //             if (instruction.xTo > instruction.x && instruction.yTo === instruction.y) {
        //                 lineDirection = LineDirection.Horizontal;
        //             } else if (instruction.xTo === instruction.x && instruction.yTo > instruction.y) {
        //                 lineDirection = LineDirection.Vertical;
        //             } else {
        //                 continue;
        //             }

        //             const mergeInstructionIndex = mergingInstructions1D.findIndex(mInstruction => {
        //                 if (mInstruction.direction !== lineDirection) {
        //                     return false;
        //                 }

        //                 if (mInstruction.direction === LineDirection.Horizontal && instruction.y !== mInstruction.startY) {
        //                     return false;
        //                 }

        //                 if (mInstruction.direction === LineDirection.Vertical && instruction.x !== mInstruction.startX) {
        //                     return false;
        //                 }

        //                 if (mInstruction.color !== instruction.color) {
        //                     return false;
        //                 }

        //                 if (mInstruction.opacity !== instruction.opacity) {
        //                     return false;
        //                 }

        //                 return true;
        //             })

        //             if (mergeInstructionIndex === -1 || mergeInstructionIndex === undefined) {
        //                 mergingInstructions1D.push({
        //                     type: "line",
        //                     direction: lineDirection,
        //                     startX: instruction.x,
        //                     startY: instruction.y,
        //                     instructionIndices: [instructionIndex],
        //                     opacity: instruction.opacity,
        //                     color: instruction.color,
        //                     lineWidth: instruction.lineWidth
        //                 })
        //             }
        //         }
        //     }
        // }
        if (force || JSON.stringify(this.lastFrame) !== JSON.stringify(layers)) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

            for (let layer of layers) {
                for (let instruction of layer) {
                    this.ctx.globalAlpha = instruction.opacity;

                    if (instruction.type === "fillrect") {
                        if (instruction.x + instruction.width < 0 || instruction.x > this.canvas.width ||
                            instruction.y + instruction.height < 0 || instruction.y > this.canvas.height) {
                            continue; // Skip rendering if out of bounds
                        }

                        this.ctx.fillStyle = instruction.color;
                        this.ctx.fillRect(instruction.x, instruction.y, instruction.width, instruction.height);
                    }

                    if (instruction.type === "strokerect") {
                        if (instruction.x + instruction.width + (instruction.lineWidth / 2) < 0 || instruction.x > this.canvas.width ||
                            instruction.y + instruction.height + (instruction.lineWidth / 2) < 0 || instruction.y > this.canvas.height) {
                            continue; // Skip rendering if out of bounds
                        }

                        this.ctx.strokeStyle = instruction.color;
                        this.ctx.lineWidth = instruction.lineWidth;
                        this.ctx.strokeRect(instruction.x, instruction.y, instruction.width, instruction.height);
                    }

                    if ((instruction.type === "text" || instruction.type === "textstroke") && instruction.rotationDegrees !== 0) {
                        this.ctx.translate(instruction.x + (instruction.dimensions[0] / 2), instruction.y + (instruction.dimensions[1] / 2));
                        this.ctx.rotate((instruction.rotationDegrees * Math.PI) / 180);
                        this.ctx.translate(-(instruction.x + (instruction.dimensions[0] / 2)), -(instruction.y + (instruction.dimensions[1] / 2)));
                    }

                    if (instruction.type === "text") {
                        this.ctx.font = instruction.font;
                        this.ctx.fillStyle = instruction.color;
                        this.ctx.fillText(instruction.text, instruction.x, instruction.y);
                    }
                    
                    if (instruction.type === "textstroke") {
                        this.ctx.font = instruction.font;
                        this.ctx.strokeStyle = instruction.color;
                        this.ctx.lineWidth = instruction.lineWidth;
                        this.ctx.strokeText(instruction.text, instruction.x, instruction.y);
                    }

                    if ((instruction.type === "text" || instruction.type === "textstroke") && instruction.rotationDegrees !== 0) {
                        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
                    }

                    if (instruction.type === "path") {
                        this.ctx.fillStyle = instruction.color;
                        this.ctx.beginPath();
                        const matrix = new DOMMatrix();

                        // Scale so that the path stays the same relative to the renderedcellsize
                        matrix.scaleSelf(this.camera.zoom, this.camera.zoom);
                        matrix.scaleSelf(0.12, 0.12);


                        const path = new Path2D();
                        path.addPath(new Path2D(instruction.path), matrix);

                        this.ctx.translate(instruction.x, instruction.y);
                        this.ctx.fill(path);
                        this.ctx.translate(-instruction.x, -instruction.y);
                    }

                    if (instruction.type === "line") {
                        this.ctx.strokeStyle = instruction.color;
                        this.ctx.lineWidth = instruction.lineWidth;

                        this.ctx.beginPath();
                        this.ctx.moveTo(instruction.x, instruction.y);
                        this.ctx.lineTo(instruction.xTo, instruction.yTo);
                        this.ctx.stroke();
                    }
                }
            }

            this.lastFrame = layers;
        }


        if (this.mode !== "no-interact") {
            this.collisions.registerCollisions(collisions);
        }

        if (this.mode === "edit" || this.mode === "preview") {
            this.ctx.font = `${16}px Arial`;
            this.ctx.fillStyle = "#0F0";
            this.ctx.fillText(this.fpsCounter.frameCount.toString(), 10, 20);

            this.fpsCounter.tick();
        }

        this.lastFrameTimestamp = performance.now()
    }

    getSpecifiedCellStyle(cellIndex: number): CellStyleOverride {
        const cell = this.history.mapLayout.cells[cellIndex];

        return cell?.styleOverride || {};
    }

    getCellStyle(cell: Cell, hoverState: boolean, selectedState: boolean): {
        backgroundColor: string,
        borderColor: string,
        borderWidth: number,
        borderTop: boolean,
        borderBottom: boolean,
        borderLeft: boolean,
        borderRight: boolean,
        text: string,
        textFont: string,
        textSize: number,
        textColor: string,
        textOpacity: number,
        textWeight: string,
        textTranslateX: number,
        textTranslateY: number,
        textStrokeColor: string,
        textStrokeLineWidth: number,
        textRotationDegrees: number,
        opacity: number
    } {
        if (cell === null) {
            return {
                backgroundColor: "#000",
                borderColor: "#000",
                borderWidth: 0,
                borderTop: true,
                borderBottom: true,
                borderLeft: true,
                borderRight: true,
                text: "",
                textFont: "Arial",
                textSize: 12,
                textColor: "#FFF",
                textOpacity: 1,
                textWeight: "normal",
                textTranslateX: 0,
                textTranslateY: 0,
                textStrokeColor: "",
                textStrokeLineWidth: 0,
                textRotationDegrees: 0,
                opacity: 0
            };
        }

        let style = { ...DEFAULT_CELL_STYLES[cell.type] } as {
            backgroundColor: string,
            borderColor: string,
            borderWidth: number,
            borderTop: boolean,
            borderBottom: boolean,
            borderLeft: boolean,
            borderRight: boolean,
            text: string,
            textFont: string,
            textWeight: string,
            opacity: number,
            textSize: number,
            textColor: string,
            textOpacity: number,
            textTranslateX: number,
            textTranslateY: number,
            textStrokeColor: string,
            textStrokeLineWidth: number,
            textRotationDegrees: number
        }

        if (cell.type === "seat" && cell.name) {
            style.text = cell.name;
        }

        for (const key in style) {
            if (key === "hoverOverride" || key === "selectedOverride") continue;

            // @ts-ignore
            style[key] = cell.styleOverride?.[key] || style[key];
        }

        if (hoverState) {
            Object.assign(style, DEFAULT_CELL_STYLES[cell.type].hoverOverride);
            Object.assign(style, cell.styleOverride || {});

            if (cell.styleOverride?.hoverOverride) {
                Object.assign(style, cell.styleOverride.hoverOverride);
            }
        }

        if (selectedState) {
            Object.assign(style, DEFAULT_CELL_STYLES[cell.type].hoverOverride);
            Object.assign(style, DEFAULT_CELL_STYLES[cell.type].selectedOverride);
            Object.assign(style, cell.styleOverride || {});
            Object.assign(style, cell.styleOverride?.hoverOverride || {});

            if (cell.styleOverride?.selectedOverride) {
                Object.assign(style, cell.styleOverride.selectedOverride);
            }
        }

        style.borderWidth = +style.borderWidth;
        style.textSize = +style.textSize;
        style.textOpacity = +style.textOpacity;
        style.textTranslateX = +style.textTranslateX;
        style.textTranslateY = +style.textTranslateY;
        style.textStrokeLineWidth = +style.textStrokeLineWidth;
        style.textRotationDegrees = +style.textRotationDegrees;

        return style;
    }

    public togglePreview() {
        if (this.mode === "edit") {
            this.mode = "preview";
        } else if (this.mode === "preview") {
            this.mode = "edit";
        }

        this.state.selectedCells = [];
        this.state.hoveredCell = -1;

        this.render();
    }

    exportMapLayout(): MapLayoutInput {
        const { mapLayout } = this.history;
        const cells: (Cell | `${number}`)[] = [];

        let comboCount = 0;

        for (let cell of mapLayout.cells) {
            if (cell === null) {
                comboCount++;

                continue;
            }

            if (comboCount > 0) {
                cells.push(`${comboCount}`);
                comboCount = 0;
            }

            const cellCopy: Cell = { ...cell };

            if (JSON.stringify(cellCopy.styleOverride) === "{}" || cellCopy.styleOverride === undefined) {
                delete cellCopy.styleOverride;
            }

            cells.push(cellCopy);
        }

        if (comboCount > 0) {
            cells.push(`${comboCount}`);
        }

        const exportData: MapLayoutInput = {
            x: mapLayout.x,
            y: mapLayout.y,
            cells: cells,
            globalOverride: {
                backgroundColor: mapLayout.globalOverride.backgroundColor,
                zoomLevel: mapLayout.globalOverride.zoomLevel,
                cellStyleOverride: {
                    seat: mapLayout.globalOverride.cellStyleOverride.seat,
                    aisle: mapLayout.globalOverride.cellStyleOverride.aisle,
                    wall: mapLayout.globalOverride.cellStyleOverride.wall,
                    door: mapLayout.globalOverride.cellStyleOverride.door,
                    custom: mapLayout.globalOverride.cellStyleOverride.custom
                }
            }
        }


        if (exportData.globalOverride) {
            if (exportData.globalOverride.cellStyleOverride) {
                for (const key in exportData.globalOverride.cellStyleOverride) {
                    //@ts-expect-error
                    if (exportData.globalOverride.cellStyleOverride[key] === undefined) {
                        //@ts-expect-error
                        delete exportData.globalOverride.cellStyleOverride[key];
                    }
                }
            }
            if (JSON.stringify(exportData.globalOverride.cellStyleOverride) === "{}" || exportData.globalOverride.cellStyleOverride === undefined) {
                delete exportData.globalOverride.cellStyleOverride;
            }
            if (exportData.globalOverride.backgroundColor === DEFAULT_MAP_BACKGROUND_COLOR || exportData.globalOverride.backgroundColor === undefined) {
                delete exportData.globalOverride.backgroundColor;
            }
            if (exportData.globalOverride.zoomLevel === DEFAULT_ZOOM_LEVEL || exportData.globalOverride.zoomLevel === undefined) {
                delete exportData.globalOverride.zoomLevel;
            }

        }

        if (JSON.stringify(exportData.globalOverride) === "{}" || exportData.globalOverride === undefined) {
            delete exportData.globalOverride;
        }

        return exportData;
    }

    private touchToExtendedTouch(touch: Touch): ExtendedTouch {
        return {
            identifier: touch.identifier,
            pageX: touch.pageX,
            pageY: touch.pageY,
            hasMoved: false
        }
    }

    ongoingTouchIndexById(idToFind: number) {
        for (let i = 0; i < this.ongoingTouches.length; i++) {
            const id = this.ongoingTouches[i].identifier;

            if (id === idToFind) {
                return i;
            }
        }
        return -1;
    }

    private setCursor(cursor: string) {
        this.canvas.style.cursor = cursor;
    }

    public unselectCells() {
        this.state.selectedCells = [];

        if (this.mode === "edit") {
            this.editMenu?.selectCells(this.state.selectedCells);
        }

        this.render();
    }
}
