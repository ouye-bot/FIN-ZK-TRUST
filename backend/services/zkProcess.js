const zkService = require('./zkService');

process.on('message', async (task) => {
  const { id, type, args } = task;
  try {
    let result;
    if (type === 'generate') {
      result = await zkService.generateProof(...args);
    } else if (type === 'verify') {
      result = await zkService.verifyProof(...args);
    }
    process.send({ id, success: true, result });
  } catch (err) {
    process.send({ id, success: false, error: err.message });
  }
});

process.send({ type: 'ready' });