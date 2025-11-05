import { MouseButtons } from "./data.ts";
import EditMenu from "./EditMenu";
import Map from "./Map.ts";
import type { Collision, CollisionCallback, DragCallback } from "./types";

export default class CollisionManager<ref> {
    map: Map | EditMenu;

    collisions: Collision<ref>[] = [];
    activeClickCollisions: Collision<ref>[] = [];
    activeHoverCollisions: Collision<ref>[] = [];

    listeners: {
        click: CollisionCallback<ref>[],
        hover: CollisionCallback<ref>[],
        drag: DragCallback[];
        dragend: DragCallback[];
    } = {
            click: [],
            hover: [],
            drag: [],
            dragend: []
        }

    drag: {
        start: {
            x: number;
            y: number;
        },
        latest: {
            x: number;
            y: number;
        }
    } = {
            start: {
                x: 0,
                y: 0
            },
            latest: {
                x: 0,
                y: 0
            }
        }

    mouseState: {
        mouseButtonsDown: MouseButtons[];
    } = {
            mouseButtonsDown: []
        };

    constructor(map: Map | EditMenu) {
        this.map = map;

        this.map.canvas.addEventListener("mousedown", (event) => {
            event.preventDefault();
            this.map.canvas.focus();

            const { offsetX, offsetY } = event;

            this.drag.latest.x = offsetX;
            this.drag.latest.y = offsetY;
            this.drag.start.x = offsetX;
            this.drag.start.y = offsetY;

            if (!this.mouseState.mouseButtonsDown.includes(event.button)) {
                this.mouseState.mouseButtonsDown.push(event.button);
            }
        });

        this.map.canvas.addEventListener("mousemove", (event) => {
            event.preventDefault();

            const { offsetX, offsetY } = event;

            if (offsetX !== this.drag.latest.x || offsetY !== this.drag.latest.y) {
                for (const listener of this.listeners.drag) {
                    listener(offsetX - this.drag.latest.x, offsetY - this.drag.latest.y, this.mouseState.mouseButtonsDown);
                }
            }

            this.drag.latest.x = offsetX;
            this.drag.latest.y = offsetY;

            this.activeHoverCollisions = this.collisions.filter(collision => {
                return collision.x <= offsetX &&
                    collision.x + collision.width >= offsetX &&
                    collision.y <= offsetY &&
                    collision.y + collision.height >= offsetY;
            })

            for (const collision of this.activeHoverCollisions) {
                for (const listener of this.listeners.hover) {
                    listener(collision, this.mouseState.mouseButtonsDown);
                }
            }

            if (this.activeHoverCollisions.length === 0) {
                for (const listener of this.listeners.hover) {
                    listener({
                        x: -1,
                        y: -1,
                        width: 0,
                        height: 0,
                        reference: -1
                    }, this.mouseState.mouseButtonsDown);
                }
            }
        });

        this.map.canvas.addEventListener("mouseup", (event) => {
            event.preventDefault();

            const { offsetX, offsetY } = event;

            if (offsetX === this.drag.start.x &&
                offsetY === this.drag.start.y) {
                this.activeClickCollisions = this.collisions.filter(collision => {
                    return collision.x <= offsetX &&
                        collision.x + collision.width >= offsetX &&
                        collision.y <= offsetY &&
                        collision.y + collision.height >= offsetY;
                });
            } else {
                this.activeClickCollisions = [];
            }

            for (const collision of this.activeClickCollisions) {
                for (const listener of this.listeners.click) {
                    listener(collision, this.mouseState.mouseButtonsDown);
                }
            }

            if (this.activeClickCollisions.length === 0) {
                for (const listener of this.listeners.dragend) {
                    listener(offsetX - this.drag.latest.x, offsetY - this.drag.latest.y, this.mouseState.mouseButtonsDown);
                }
            }

            this.activeClickCollisions = [];

            const buttonIndex = this.mouseState.mouseButtonsDown.indexOf(event.button);

            if (buttonIndex !== -1) {
                this.mouseState.mouseButtonsDown.splice(buttonIndex, 1);
            }
        });
    }

    addEventListener(type: "click" | "hover", callback: CollisionCallback<ref>): void;
    addEventListener(type: "drag" | "dragend", callback: DragCallback): void;
    addEventListener(type: "click" | "hover" | "drag" | "dragend", callback: CollisionCallback<ref> | DragCallback) {
        if (type in this.listeners) {
            // @ts-expect-error
            this.listeners[type].push(callback);
        } else {
            throw new Error(`Invalid event type: ${type}`);
        }
    }

    registerCollisions(collisions: Collision<ref>[]) {
        this.collisions = collisions;
    }

    leftClick(x: number, y: number) {
        this.activeClickCollisions = this.collisions.filter(collision => {
            return collision.x <= x &&
                collision.x + collision.width >= x &&
                collision.y <= y &&
                collision.y + collision.height >= y;
        });

        for (const collision of this.activeClickCollisions) {
            for (const listener of this.listeners.click) {
                listener(collision, [MouseButtons.LEFT]);
            }
        }
    }
}