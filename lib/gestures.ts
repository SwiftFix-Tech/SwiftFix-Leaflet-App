export class LongPress {
  private timer?: ReturnType<typeof setTimeout>;
  private origin?: { x: number; y: number };
  fired = false;
  start(x: number, y: number, action: () => void) {
    this.cancel();
    this.fired = false;
    this.origin = { x, y };
    this.timer = setTimeout(() => {
      this.fired = true;
      action();
    }, 550);
  }
  move(x: number, y: number) {
    if (this.origin && Math.hypot(x - this.origin.x, y - this.origin.y) > 8)
      this.cancel();
  }
  cancel() {
    clearTimeout(this.timer);
    this.origin = undefined;
  }
}
