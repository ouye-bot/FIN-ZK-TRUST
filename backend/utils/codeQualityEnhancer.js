/**
 * 代码质量增强器
 * 提供代码质量检测、性能分析和安全审查功能
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

class CodeQualityEnhancer {
  constructor() {
    this.issues = [];
    this.metrics = {
      totalFiles: 0,
      totalLines: 0,
      complexity: 0,
      securityIssues: 0,
      performanceIssues: 0
    };
  }

  /**
   * 分析代码质量
   * @param {string} targetDir - 目标目录
   * @returns {Object} 分析结果
   */
  analyzeCodeQuality(targetDir = path.join(__dirname, '..')) {
    logger.info('开始代码质量分析...');
    this.issues = [];
    this.resetMetrics();

    try {
      this.scanDirectory(targetDir);
      
      const result = {
        success: true,
        metrics: this.metrics,
        issues: this.issues,
        summary: this.generateSummary(),
        timestamp: new Date().toISOString()
      };

      logger.info('代码质量分析完成', result.summary);
      return result;
    } catch (error) {
      logger.error('代码质量分析失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 扫描目录
   * @private
   */
  scanDirectory(dir, depth = 0) {
    if (depth > 3) return; // 限制扫描深度

    const items = fs.readdirSync(dir);
    
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        // 跳过 node_modules 和隐藏目录
        if (item !== 'node_modules' && !item.startsWith('.')) {
          this.scanDirectory(fullPath, depth + 1);
        }
      } else if (stat.isFile() && this.isJavaScriptFile(item)) {
        this.analyzeFile(fullPath);
      }
    }
  }

  /**
   * 检查是否为JavaScript文件
   * @private
   */
  isJavaScriptFile(filename) {
    return filename.endsWith('.js') && !filename.includes('.test.') && !filename.includes('.spec.');
  }

  /**
   * 分析单个文件
   * @private
   */
  analyzeFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      
      this.metrics.totalFiles++;
      this.metrics.totalLines += lines.length;

      // 检查安全问题
      this.checkSecurityIssues(filePath, content, lines);
      
      // 检查性能问题
      this.checkPerformanceIssues(filePath, content, lines);
      
      // 检查代码复杂度
      this.checkComplexity(filePath, content, lines);
      
      // 检查代码规范
      this.checkCodeStyle(filePath, content, lines);

    } catch (error) {
      logger.warning(`分析文件失败: ${filePath}`, error.message);
    }
  }

  /**
   * 检查安全问题
   * @private
   */
  checkSecurityIssues(filePath, content, lines) {
    const securityPatterns = [
      { pattern: /eval\s*\(/, severity: 'high', description: '使用eval()存在代码注入风险' },
      { pattern: /new\s+Function\s*\(/, severity: 'high', description: '使用Function构造函数存在风险' },
      { pattern: /console\.log\s*\(/, severity: 'low', description: '生产环境应避免使用console.log' },
      { pattern: /password\s*[=:]\s*['"][^'"]+['"]/i, severity: 'high', description: '硬编码密码' },
      { pattern: /secret\s*[=:]\s*['"][^'"]+['"]/i, severity: 'high', description: '硬编码密钥' },
      { pattern: /TODO|FIXME|XXX/, severity: 'low', description: '存在未完成的代码标记' }
    ];

    lines.forEach((line, index) => {
      securityPatterns.forEach(({ pattern, severity, description }) => {
        if (pattern.test(line)) {
          this.issues.push({
            type: 'security',
            severity,
            file: filePath,
            line: index + 1,
            description,
            code: line.trim()
          });
          this.metrics.securityIssues++;
        }
      });
    });
  }

  /**
   * 检查性能问题
   * @private
   */
  checkPerformanceIssues(filePath, content, lines) {
    const performancePatterns = [
      { pattern: /for\s*\([^)]+\)\s*\{[^}]*for\s*\(/, description: '嵌套循环可能影响性能' },
      { pattern: /\.sync\s*\(/, description: '同步操作可能阻塞事件循环' },
      { pattern: /new\s+Array\s*\(\s*\d+\s*\)/, description: '预分配大数组可能消耗大量内存' }
    ];

    lines.forEach((line, index) => {
      performancePatterns.forEach(({ pattern, description }) => {
        if (pattern.test(line)) {
          this.issues.push({
            type: 'performance',
            severity: 'medium',
            file: filePath,
            line: index + 1,
            description,
            code: line.trim()
          });
          this.metrics.performanceIssues++;
        }
      });
    });
  }

  /**
   * 检查代码复杂度
   * @private
   */
  checkComplexity(filePath, content, lines) {
    let functionCount = 0;
    let maxNestingDepth = 0;
    let currentDepth = 0;

    lines.forEach((line) => {
      // 计算函数数量
      if (/function\s+\w+|=>\s*\{|async\s+function/.test(line)) {
        functionCount++;
      }

      // 计算嵌套深度
      const openBraces = (line.match(/\{/g) || []).length;
      const closeBraces = (line.match(/\}/g) || []).length;
      
      currentDepth += openBraces - closeBraces;
      maxNestingDepth = Math.max(maxNestingDepth, currentDepth);
    });

    // 如果函数过多或嵌套太深，记录问题
    if (functionCount > 10) {
      this.issues.push({
        type: 'complexity',
        severity: 'medium',
        file: filePath,
        line: 0,
        description: `文件包含${functionCount}个函数，建议拆分`,
        code: ''
      });
    }

    if (maxNestingDepth > 4) {
      this.issues.push({
        type: 'complexity',
        severity: 'high',
        file: filePath,
        line: 0,
        description: `最大嵌套深度为${maxNestingDepth}，建议重构`,
        code: ''
      });
    }

    this.metrics.complexity += functionCount;
  }

  /**
   * 检查代码规范
   * @private
   */
  checkCodeStyle(filePath, content, lines) {
    lines.forEach((line, index) => {
      // 检查行长度
      if (line.length > 120) {
        this.issues.push({
          type: 'style',
          severity: 'low',
          file: filePath,
          line: index + 1,
          description: '行长度超过120字符',
          code: line.substring(0, 50) + '...'
        });
      }

      // 检查尾随空格
      if (/\s+$/.test(line)) {
        this.issues.push({
          type: 'style',
          severity: 'low',
          file: filePath,
          line: index + 1,
          description: '存在尾随空格',
          code: line.trim()
        });
      }
    });
  }

  /**
   * 重置指标
   * @private
   */
  resetMetrics() {
    this.metrics = {
      totalFiles: 0,
      totalLines: 0,
      complexity: 0,
      securityIssues: 0,
      performanceIssues: 0
    };
  }

  /**
   * 生成汇总报告
   * @private
   */
  generateSummary() {
    const highIssues = this.issues.filter(i => i.severity === 'high').length;
    const mediumIssues = this.issues.filter(i => i.severity === 'medium').length;
    const lowIssues = this.issues.filter(i => i.severity === 'low').length;

    return {
      totalFiles: this.metrics.totalFiles,
      totalLines: this.metrics.totalLines,
      totalIssues: this.issues.length,
      highSeverity: highIssues,
      mediumSeverity: mediumIssues,
      lowSeverity: lowIssues,
      complexity: this.metrics.complexity,
      qualityScore: this.calculateQualityScore()
    };
  }

  /**
   * 计算质量评分
   * @private
   */
  calculateQualityScore() {
    if (this.metrics.totalFiles === 0) return 100;
    
    const baseScore = 100;
    const deductions = {
      high: 10,
      medium: 5,
      low: 1
    };

    let totalDeduction = 0;
    this.issues.forEach(issue => {
      totalDeduction += deductions[issue.severity] || 0;
    });

    return Math.max(0, baseScore - totalDeduction);
  }

  /**
   * 生成质量报告文件
   * @param {string} outputPath - 输出路径
   */
  generateReport(outputPath = path.join(__dirname, '../logs/code-quality-report.json')) {
    const result = this.analyzeCodeQuality();
    
    if (result.success) {
      fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
      logger.info(`代码质量报告已生成: ${outputPath}`);
    }
    
    return result;
  }
}

module.exports = new CodeQualityEnhancer();
