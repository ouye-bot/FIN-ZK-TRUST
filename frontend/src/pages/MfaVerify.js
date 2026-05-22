import React, { useState, useRef, useEffect } from 'react';
import { Container, Paper, Typography, TextField, Button, Box, Alert, Collapse } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { useNavigate } from 'react-router-dom';

const API_BASE = '/api/v1';

function MfaVerify({ onLoginSuccess }) {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showBackupCodes, setShowBackupCodes] = useState(false);
  const navigate = useNavigate();

  // 组件卸载安全锁
  const isMountedRef = useRef(true);
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // 安全的 setState 辅助函数
  const safeSetError = (msg) => {
    if (isMountedRef.current) setError(msg);
  };
  const safeSetLoading = (val) => {
    if (isMountedRef.current) setLoading(val);
  };

  const handleVerify = async () => {
    if (token.length !== 6 && token.length !== 8) {
      safeSetError('请输入6位验证码或8位备用码');
      return;
    }

    const tempToken = localStorage.getItem('tempToken');
    if (!tempToken) {
      safeSetError('临时令牌已过期，请重新登录');
      return;
    }

    // 注：此处不设置 loading 状态，因为成功跳转前组件即将卸载，
    // 任何状态更新都可能导致与路由卸载的渲染冲突。
    try {
      const response = await fetch(`${API_BASE}/mfa/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tempToken}`
        },
        body: JSON.stringify({ token })
      });

      const data = await response.json();
    if (data.success) {
      // 将认证信息暂存到 sessionStorage，用于页面刷新后恢复
      sessionStorage.setItem('mfa_auth', JSON.stringify({
        token: data.token,
        user: data.user,
        sessionKey: data.sessionKey
      }));
      // 清理临时 token
      localStorage.removeItem('tempToken');
      // 延迟跳转，让 React 完成 DOM 卸载（避免 MUI Collapse 动画冲突）
      setTimeout(() => {
        window.location.href = '/profile';
      }, 100);
      return;
    } else {
        safeSetError(data.message || '验证码无效');
        safeSetLoading(false);
      }
    } catch (err) {
      safeSetError('网络错误，请稍后重试');
      safeSetLoading(false);
    }
  };

  const handleBackToLogin = () => {
    localStorage.removeItem('tempToken');
    navigate('/');
  };

  return (
    <Container maxWidth="sm" sx={{ mt: 8 }}>
      <Paper sx={{ p: 4 }}>
        <Typography variant="h5" gutterBottom>
          双因子验证
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          请输入身份验证器中的6位验证码
        </Typography>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <TextField
          fullWidth
          value={token}
          onChange={(e) => setToken(e.target.value.replace(/\s/g, ''))}
          placeholder={showBackupCodes ? "8位备用码" : "6位验证码"}
          inputProps={{ maxLength: showBackupCodes ? 8 : 6 }}
          sx={{ mb: 2 }}
        />

        <Button
          variant="contained"
          color="primary"
          fullWidth
          onClick={handleVerify}
          disabled={loading}
          sx={{ mb: 2 }}
        >
          {loading ? '验证中...' : '验证'}
        </Button>

        <Box sx={{ textAlign: 'center', mb: 2 }}>
          <Button
            onClick={() => setShowBackupCodes(!showBackupCodes)}
            endIcon={showBackupCodes ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          >
            {showBackupCodes ? '使用验证码登录' : '使用备用码登录'}
          </Button>
        </Box>

        <Button
          variant="text"
          fullWidth
          onClick={handleBackToLogin}
        >
          返回登录
        </Button>
      </Paper>
    </Container>
  );
}

export default MfaVerify;