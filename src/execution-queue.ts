type Waiter = {wake:() => void};

export class ExecutionQueue {
  private active = 0;
  private waiting:Waiter[] = [];

  constructor(private readonly concurrency:number,private readonly capacity:number,private readonly waitMs:number) {}

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
      const next = this.waiting.shift();
      if (next) next.wake();
      else this.active--;
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
