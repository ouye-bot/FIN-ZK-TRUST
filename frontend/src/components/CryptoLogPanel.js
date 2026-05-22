import React, { useState } from 'react';
import { get } from '../utils/apiUtils';
import {
  Box,
  Typography,
  Paper,
  List,
  ListItem,
  ListItemText,
  Divider,
  IconButton,
  Collapse,
  Chip,
  Tooltip,
  Button,
  CircularProgress,
  Alert
} from '@mui/material';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CloseIcon from '@mui/icons-material/Close';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';

const CryptoLogPanel = ({ logs, isVisible, onToggle, user }) => {
  const [expandedLogId, setExpandedLogId] = useState(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState(null);
  const [verifyError, setVerifyError] = useState('');
  const [allLogs, setAllLogs] = useState([]);
  const [totalCount, setTotalCount] = useState(0);

  // 从后端获取当前用户的日志列表
  React.useEffect(() => {
    const fetchLogs = async () => {
      try {
        const token = localStorage.getItem('token');
        const userId = user?.id || user?.userId || '';
        const url = userId
          ? `/api/v1/crypto-log?limit=200&userId=${encodeURIComponent(userId)}`
          : '/api/v1/crypto-log?limit=200';
        const resp = await get(url);
        const data = await resp.json();
        if (data.success && data.data) {
          setAllLogs(data.data.logs || []);
          setTotalCount(data.data.total || 0);
        }
      } catch (e) { /* ignore */ }
    };
    if (isVisible) fetchLogs();
  }, [isVisible, logs.length, user?.id, user?.userId]);

  const handleLogToggle = (logId) => {
    setExpandedLogId(expandedLogId === logId ? null : logId);
  };

  const handleVerify = async () => {
    setIsVerifying(true);
    setVerifyResult(null);
    setVerifyError('');

    try {
      const token = localStorage.getItem('token');
      const response = await get('/api/v1/audit/verify');

      if (!response.ok) {
        throw new Error('验证请求失败');
      }

      const data = await response.json();
      if (data.success) {
        setVerifyResult({
          valid: data.valid,
          totalEntries: data.totalEntries,
          firstInvalidIndex: data.firstInvalidIndex
        });
      } else {
        setVerifyError(data.message || '验证失败');
      }
    } catch (err) {
      console.error('审计链验证失败:', err);
      setVerifyError('网络错误，无法完成验证');
    } finally {
      setIsVerifying(false);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case '成功':
        return 'success';
      case '失败':
        return 'error';
      case '发起':
        return 'warning';
      default:
        return 'info';
    }
  };

  return (
    <Collapse in={isVisible}>
      <Paper sx={{ 
        position: 'fixed', 
        bottom: 0, 
        right: 0, 
        left: 0, 
        maxHeight: '300px', 
        overflow: 'auto',
        zIndex: 1000,
        borderTop: '1px solid #e0e0e0'
      }}>
        <Box sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          p: 2,
          borderBottom: '1px solid #e0e0e0'
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Typography variant="h6">
              密码操作日志
            </Typography>
            <Button
              size="small"
              variant="outlined"
              startIcon={isVerifying ? <CircularProgress size={14} /> : <VerifiedUserIcon />}
              onClick={handleVerify}
              disabled={isVerifying}
              sx={{ fontSize: '0.75rem' }}
            >
              {isVerifying ? '验证中...' : '验证全局审计链'}
            </Button>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="body2" color="text.secondary">
              我的日志: {totalCount || logs.length} 条
            </Typography>
            <IconButton onClick={onToggle} size="small">
              <CloseIcon />
            </IconButton>
          </Box>
        </Box>

        {(isVerifying || verifyResult || verifyError) && (
          <Box sx={{ p: 2, pt: 1, pb: 1 }}>
            {isVerifying && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CircularProgress size={16} />
                <Typography variant="caption" color="text.secondary">正在验证...</Typography>
              </Box>
            )}

            {verifyResult && (
              <Alert severity={verifyResult.valid ? 'success' : 'error'} sx={{ py: 0.5 }}>
                {verifyResult.valid
                  ? `✅ 全局审计链完整，共 ${verifyResult.totalEntries} 条日志（含全部用户），未发现篡改`
                  : `❌ 全局审计链已被篡改，第 ${verifyResult.firstInvalidIndex} 条日志异常（共 ${verifyResult.totalEntries} 条）`
                }
              </Alert>
            )}

            {verifyError && (
              <Alert severity="warning" sx={{ py: 0.5 }}>{verifyError}</Alert>
            )}
          </Box>
        )}
        
        <List dense>
          {allLogs.length === 0 && logs.length === 0 ? (
            <ListItem>
              <ListItemText
                primary="暂无密码操作日志"
                secondary="执行密码相关操作后将在此显示"
              />
            </ListItem>
          ) : (
            (allLogs.length > 0 ? allLogs : logs.slice().reverse()).map((log) => (
              <React.Fragment key={log.id}>
                <ListItem 
                  secondaryAction={
                    <IconButton 
                      edge="end" 
                      onClick={() => handleLogToggle(log.id)}
                    >
                      {expandedLogId === log.id ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                    </IconButton>
                  }
                >
                  <Box sx={{ minWidth: '100px', mr: 2 }}>
                    <Typography variant="body2" color="text.secondary">
                      {log.timestamp}
                    </Typography>
                  </Box>
                  <Box sx={{ minWidth: '120px', mr: 2 }}>
                    <Chip 
                      label={log.operationType} 
                      size="small" 
                      variant="outlined"
                    />
                  </Box>
                  <Box sx={{ flex: 1, mr: 2 }}>
                    <Typography variant="body2" fontWeight="medium">
                      {log.description}
                    </Typography>
                  </Box>
                  <Box sx={{ minWidth: '80px' }}>
                    <Chip
                      label={log.status || log.data?.status || '未知'}
                      size="small"
                      color={getStatusColor(log.status || log.data?.status)}
                    />
                  </Box>
                </ListItem>
                <Collapse in={expandedLogId === log.id} timeout="auto" unmountOnExit>
                  <Box sx={{ pl: 4, pr: 4, pb: 2 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      详细信息: {log.detail || log.data?.detail || '无'}
                    </Typography>
                    {(log.correlationInfo || log.data?.correlationInfo) && (
                      <Typography variant="body2" color="text.secondary">
                        关联信息: {JSON.stringify(log.correlationInfo || log.data?.correlationInfo)}
                      </Typography>
                    )}
                  </Box>
                </Collapse>
                <Divider />
              </React.Fragment>
            ))
          )}
        </List>
      </Paper>
    </Collapse>
  );
};

export default CryptoLogPanel;