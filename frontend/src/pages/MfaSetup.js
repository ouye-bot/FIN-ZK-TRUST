import React, { useState, useEffect } from 'react';
import { Container, Paper, Typography, TextField, Button, Box, Alert, Dialog, DialogTitle, DialogContent, DialogActions } from '@mui/material';
import { QRCodeSVG } from 'qrcode.react';
import DownloadIcon from '@mui/icons-material/Download';
import CopyIcon from '@mui/icons-material/ContentCopy';
import { useNavigate } from 'react-router-dom';
import { useAesKey } from '../App';
import { deriveTransportKey, encryptDeviceKey } from '../utils/deviceKeyManager';
import { get, post } from '../utils/apiUtils';

const API_BASE = '/api/v1';

function MfaSetup({ user }) {
  const [setupData, setSetupData] = useState(null);
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [showBackupCodes, setShowBackupCodes] = useState(false);
  const [backupCodes, setBackupCodes] = useState([]);
  const navigate = useNavigate();
  const currentAesKey = useAesKey();

  useEffect(() => {
    fetchSetupData();
  }, []);

  const fetchSetupData = async () => {
    try {
      const response = await get(`${API_BASE}/mfa/setup`);

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || '获取 MFA 设置失败');
      }

      const data = await response.json();
      if (data.success) {
        setSetupData(data);
      } else {
        setError(data.message || '获取 MFA 设置失败');
      }
    } catch (err) {
      setError(err.message || '网络错误，请稍后重试');
      console.error('MFA setup request failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    if (token.length !== 6) {
      setError('请输入6位验证码');
      return;
    }

    setVerifying(true);
    setError('');

    try {
      const response = await post(`${API_BASE}/mfa/verify-and-enable`, { token });
      const data = await response.json();
      if (data.success) {
        setBackupCodes(data.backupCodes);
        setShowBackupCodes(true);

        // 如果后端返回了 sessionKey，使用它完成设备主密钥轮转
        if (data.sessionKey && currentAesKey) {
          try {
            // 当前设备主密钥已在 currentAesKey 中
            const transportKey = await deriveTransportKey(data.sessionKey);
            const encryptedDeviceKey = await encryptDeviceKey(currentAesKey, transportKey);
            localStorage.setItem('deviceKeyEncrypted', JSON.stringify(encryptedDeviceKey));
            console.log('MFA Setup: 设备主密钥轮转成功');
          } catch (err) {
            console.error('MFA Setup: 设备主密钥轮转失败:', err);
          }
        }
      } else {
        setError(data.message || '验证失败');
      }
    } catch (err) {
      setError('网络错误，请稍后重试');
    } finally {
      setVerifying(false);
    }
  };

  const handleCopyAll = () => {
    navigator.clipboard.writeText(backupCodes.join('\n'));
  };

  const handleDownload = () => {
    const element = document.createElement('a');
    const file = new Blob([backupCodes.join('\n')], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = 'backup-codes.txt';
    element.click();
  };

  const handleClose = () => {
    setShowBackupCodes(false);
    navigate('/profile');
  };

  if (loading) {
    return (
      <Container maxWidth="sm" sx={{ mt: 8 }}>
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography>加载中...</Typography>
        </Paper>
      </Container>
    );
  }

  return (
    <Container maxWidth="sm" sx={{ mt: 8 }}>
      <Paper sx={{ p: 4 }}>
        <Typography variant="h5" gutterBottom>
          设置双因子认证
        </Typography>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Box sx={{ mb: 3 }}>
          <Typography variant="body1" gutterBottom>
            请使用身份验证器应用（如 Google Authenticator）扫描下方二维码：
          </Typography>
          <Box sx={{ display: 'flex', justifyContent: 'center', my: 3 }}>
            {setupData?.otpauthUrl && (
              <QRCodeSVG value={setupData.otpauthUrl} size={200} />
            )}
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', mb: 2 }}>
            或者手动输入密钥：
          </Typography>
          <TextField
            fullWidth
            value={setupData?.secret || ''}
            InputProps={{
              readOnly: true,
            }}
            variant="outlined"
            size="small"
          />
        </Box>

        <Box sx={{ mb: 3 }}>
          <Typography variant="body1" gutterBottom>
            输入6位验证码完成验证：
          </Typography>
          <TextField
            fullWidth
            value={token}
            onChange={(e) => setToken(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            inputProps={{ maxLength: 6 }}
          />
        </Box>

        <Button
          variant="contained"
          color="primary"
          fullWidth
          onClick={handleVerify}
          disabled={verifying || token.length !== 6}
        >
          {verifying ? '验证中...' : '验证并启用'}
        </Button>
      </Paper>

      <Dialog open={showBackupCodes} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle>备用码</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            请妥善保管以下备用码，每个码只能使用一次。如果您丢失了手机，可以使用备用码登录。
          </Alert>
          <Box sx={{ bgcolor: '#f5f5f5', p: 2, borderRadius: 1 }}>
            {backupCodes.map((code, index) => (
              <Typography key={index} variant="body1" sx={{ fontFamily: 'monospace', mb: 0.5 }}>
                {code}
              </Typography>
            ))}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCopyAll} startIcon={<CopyIcon />}>复制全部</Button>
          <Button onClick={handleDownload} startIcon={<DownloadIcon />}>下载</Button>
          <Button onClick={handleClose} variant="contained">完成</Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}

export default MfaSetup;