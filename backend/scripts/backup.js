const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

// 数据目录路径
const dataDir = path.join(__dirname, '..', 'data');
// 备份目录路径
const backupDir = path.join(__dirname, '..', 'data', 'backups');
