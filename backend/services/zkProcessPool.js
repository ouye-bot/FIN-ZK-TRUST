const { fork } = require('child_process');
const path = require('path');
const os = require('os');

const MAX_PROCESSES = Math.max(2, os.cpus().length - 1);
const processes = [];
const taskQueue = [];

for (let i = 0; i < MAX_PROCESSES; i++) {
  const child = fork(path.join(__dirname, 'zkProcess.js'), [], { silent: true });
  child.id = i + 1;
  child.idle = true;

  child.on('message', (msg) => {
    if (msg.type === 'ready') {
      console.log(`ZKP 子进程 ${child.pid} 已就绪`);
      return;
    }

    const callback = child._currentCallback;
    if (callback) {
      callback(msg);
      child._currentCallback = null;
      child.idle = true;

      if (taskQueue.length > 0) {
        const next = taskQueue.shift();
        dispatchTask(child, next.task, next.resolve, next.reject);
      }
    }
  });

  child.on('error', (err) => {
    console.error(`ZKP 子进程 ${child.pid} 错误:`, err.message);
    child.idle = false;
  });

  child.on('exit', (code) => {
    console.log(`ZKP 子进程 ${child.pid} 退出，代码: ${code}`);
    const idx = processes.indexOf(child);
    if (idx !== -1) {
      processes.splice(idx, 1);
      const newChild = fork(path.join(__dirname, 'zkProcess.js'), [], { silent: true });
      newChild.id = child.id;
      newChild.idle = true;

      newChild.on('message', (msg) => {
        if (msg.type === 'ready') {
          console.log(`ZKP 子进程 ${newChild.pid} 已就绪`);
          return;
        }
        const callback = newChild._currentCallback;
        if (callback) {
          callback(msg);
          newChild._currentCallback = null;
          newChild.idle = true;
          if (taskQueue.length > 0) {
            const next = taskQueue.shift();
            dispatchTask(newChild, next.task, next.resolve, next.reject);
          }
        }
      });

      processes.push(newChild);
    }
  });

  processes.push(child);
}

function dispatchTask(proc, task, resolve, reject) {
  proc.idle = false;
  proc._currentCallback = (msg) => {
    if (msg.success) {
      resolve(msg.result);
    } else {
      reject(new Error(msg.error));
    }
  };
  proc.send(task);
}

function runTask(task) {
  return new Promise((resolve, reject) => {
    const idleProc = processes.find(p => p.idle);
    if (idleProc) {
      dispatchTask(idleProc, task, resolve, reject);
    } else {
      taskQueue.push({ task, resolve, reject });
    }
  });
}

function getStats() {
  return {
    total: processes.length,
    idle: processes.filter(p => p.idle).length,
    busy: processes.filter(p => !p.idle).length,
    queued: taskQueue.length
  };
}

console.log(`ZKP 子进程池已初始化，共 ${MAX_PROCESSES} 个子进程`);
module.exports = { runTask, getStats };