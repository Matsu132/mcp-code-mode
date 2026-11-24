type Waiter = {wake:() => void};

export class ExecutionQueue {
  private active = 0;
  private waiting:Waiter[] = [];

  constructor(private concurrency:number,private capacity:number,private waitMs:number) {}

  configure(concurrency:number,capacity:number,waitMs:number) {
    this.concurrency = concurrency;
    this.capacity = capacity;
    this.waitMs = waitMs;
    this.dispatch();
  }

  private dispatch() {
    while (this.active<this.concurrency && this.waiting.length) {
      const next=this.waiting.shift();
      if (!next) break;
      this.active++;
      next.wake();
    }
  }

  async run<T>(signal:AbortSignal, task:() => Promise<T>):Promise<T> {
    signal.throwIfAborted();
    if (this.active >= this.concurrency) {
      if (this.waiting.length >= this.capacity) throw Error('Execution queue is full');
      await this.wait(signal);
    } else {
      this.active++;
    }
    try {
      signal.throwIfAborted();
      return await task();
    } finally {
      this.active--;
      this.dispatch();
    }
  }

  private wait(signal:AbortSignal) {
    return new Promise<void>((resolve,reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort',cancel);
      };
      const waiter = {wake:() => {cleanup();resolve();}};
      const rejectWait = (error:Error) => {
        cleanup();
        this.waiting = this.waiting.filter(candidate => candidate !== waiter);
        reject(error);
      };
      const cancel = () => rejectWait(Error('Execution cancelled'));
      const timer = setTimeout(() => rejectWait(Error('Execution queue deadline exceeded')),this.waitMs);
      this.waiting.push(waiter);
      signal.addEventListener('abort',cancel,{once:true});
    });
  }
}
