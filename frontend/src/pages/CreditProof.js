import React, { useState, useEffect } from 'react';
import { useAesKey } from '../App';
import {
  Container,
  Typography,
  Box,
  Button,
  TextField,
  Alert,
  CircularProgress,
  Grid,
  Card,
  CardContent,
  Paper
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import IconButton from '@mui/material/IconButton';
import { signWithSM2, generateSM2KeyPair } from '../utils/cryptoUtils';
import { getSM2KeyPair, saveSM2KeyPair, getSM2KeyPairWithAesKey } from '../utils/sm2Utils';
import { CreditProofCache } from '../utils/cacheUtils';
import { post, get } from '../utils/apiUtils';

const CreditProof = ({ user, cryptoLogs, setCryptoLogs }) => {
  const navigate = useNavigate();
  const aesKey = useAesKey();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [proof, setProof] = useState(null);
  const [verificationCode, setVerificationCode] = useState('');
  const [creditHistory, setCreditHistory] = useState([]);
  const [zkWorker, setZkWorker] = useState(null);
  const [zkWorkerReady, setZkWorkerReady] = useState(false);
  const [zkStatus, setZkStatus] = useState('');

  // 页面加载时检查信用证明
  useEffect(() => {
    if (user) {
      const storedProof = CreditProofCache.getProof(user.id);
      if (storedProof) {
        setProof(storedProof);
        setVerificationCode(storedProof.verificationCode);
      }
    }
  }, [user]);

  // 初始化 ZK Proof Worker
  useEffect(() => {
    const worker = new Worker(
      new URL('../workers/zkProofWorker.js', import.meta.url),
      { type: 'module' }
    );

    const initRequestId = 'init-' + Date.now();
    setZkStatus('正在加载电路文件...');

    worker.postMessage({
      type: 'INIT',
      wasmUrl: '/circuits/credit.wasm',
      zkeyUrl: '/circuits/credit_final.zkey',
      requestId: initRequestId
    });

    worker.onmessage = (e) => {
      if (e.data.type === 'INIT_COMPLETE') {
        setZkWorkerReady(true);
        setZkWorker(worker);
        setZkStatus('');
      } else if (e.data.type === 'ERROR') {
        console.error('[CreditProof] Worker init error:', e.data.error);
        setZkStatus('ZK电路加载失败');
      }
    };

    worker.onerror = (err) => {
      console.error('[CreditProof] Worker error:', err);
      setZkStatus('ZK Worker错误');
    };

    return () => {
      worker.terminate();
    };
  }, []);

  // 获取信用历史记录
  useEffect(() => {
    const fetchCreditHistory = async () => {
      try {
        const response = await get(`/api/v1/users/${user.id}`);
        const data = await response.json();
        if (data.success && data.user.creditHistory) {
          setCreditHistory(data.user.creditHistory);
        }
      } catch (err) {
        console.error('获取信用历史失败:', err);
      }
    };

    if (user) {
      fetchCreditHistory();
    }
  }, [user]);

  // 检查验证码是否即将过期
  useEffect(() => {
    if (proof) {
      const checkExpiry = () => {
        const timeLeft = proof.expiresAt - Date.now();
        if (timeLeft < 3600000) { // 少于1小时
          setError('验证码即将过期，请重新生成');
        }
      };
      
      const interval = setInterval(checkExpiry, 60000); // 每分钟检查一次
      return () => clearInterval(interval);
    }
  }, [proof]);

  // 添加密码操作日志
  const addCryptoLog = (operationType, description, status, detail, correlationInfo = null) => {
    if (setCryptoLogs) {
      const newLog = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        userId: user?.id || 'unknown',
        operationType,
        description,
        status,
        detail,
        timestamp: new Date().toLocaleString('zh-CN'),
        fullTimestamp: new Date().toISOString(),
        correlationInfo
      };
      setCryptoLogs(prevLogs => {
        const updatedLogs = [...prevLogs, newLog];
        // 保持最多50条日志
        return updatedLogs.slice(-50);
      });
    }
  };

  const handleGenerateProof = async () => {
    try {
      setLoading(true);
      setError('');
      setSuccess('');
      setZkStatus('正在生成零知识证明...');

      if (!zkWorkerReady || !zkWorker) {
        throw new Error('零知识证明引擎未就绪，请刷新页面重试');
      }

      if (!aesKey) {
        throw new Error('AES密钥不存在，请重新登录');
      }

      addCryptoLog('SM2签名', '信用证明生成', '发起', '准备生成信用证明SM2签名');

      let userWithPublicKey = user;
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(`/api/v1/users/${user.id}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        const data = await response.json();
        if (data.success) {
          userWithPublicKey = data.user;
          console.log('用户完整信息:', userWithPublicKey);
        }
      } catch (err) {
        console.error('获取用户信息失败:', err);
      }

      let keyPair = await getSM2KeyPairWithAesKey(aesKey);
      if (!keyPair || (userWithPublicKey.sm2PublicKey && keyPair.publicKey !== userWithPublicKey.sm2PublicKey)) {
        console.log('密钥对不匹配，重新生成...');
        const newKeyPair = generateSM2KeyPair();

        await saveSM2KeyPair(newKeyPair, aesKey);
        keyPair = newKeyPair;

        try {
          const token = localStorage.getItem('token');
          const updateResponse = await fetch(`/api/v1/users/${user.id}/update-sm2-key`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ sm2PublicKey: keyPair.publicKey })
          });

          const updateData = await updateResponse.json();
          if (updateData.success) {
            console.log('SM2公钥更新成功');
          } else {
            console.error('SM2公钥更新失败:', updateData.message);
          }
        } catch (updateErr) {
          console.error('更新SM2公钥失败:', updateErr);
        }
      }

      console.log('当前用户信息:', userWithPublicKey);
      console.log('使用的SM2密钥对:', keyPair);

      const creditScore = Number(userWithPublicKey.creditScore) || 0;

      const proofResult = await new Promise((resolve, reject) => {
        const requestId = 'proof-' + Date.now();

        const timeout = setTimeout(() => {
          reject(new Error('证明生成超时'));
        }, 60000);

        const handler = (e) => {
          if (e.data.requestId !== requestId) return;

          clearTimeout(timeout);
          zkWorker.removeEventListener('message', handler);

          if (e.data.type === 'PROOF_COMPLETE') {
            resolve({ proof: e.data.proof, publicSignals: e.data.publicSignals });
          } else if (e.data.type === 'ERROR') {
            reject(new Error(e.data.error));
          }
        };

        zkWorker.addEventListener('message', handler);

        zkWorker.postMessage({
          type: 'GENERATE_PROOF',
          input: { creditScore, threshold: 600 },
          requestId
        });
      });

      setZkStatus('');

      const proofData = {
        userId: userWithPublicKey.id.toString(),
        creditScore: userWithPublicKey.creditScore
      };

      const signatureData = JSON.stringify(proofData);
      console.log('生成的签名数据:', signatureData);

      const signature = signWithSM2(signatureData, keyPair.privateKey);
      console.log('生成的签名:', signature);

      keyPair.privateKey = null;

      const response = await post('/api/v1/credit/generate-proof', {
        userId: userWithPublicKey.id,
        proof: proofResult.proof,
        publicSignals: proofResult.publicSignals,
        signature
      });

      const responseData = await response.json();

      if (!response.ok) {
        throw new Error(responseData.message || '生成信用证明失败');
      }

      setProof(responseData.data.proof);
      setVerificationCode(responseData.data.proof.verificationCode);
      setSuccess('信用证明生成成功！');

      addCryptoLog('SM2签名', '信用证明生成', '成功', `生成SM2签名并获取验证码: ${responseData.data.proof.verificationCode}`);
      addCryptoLog('SM3哈希', '信用证明哈希', '成功', '信用证明数据已生成SM3哈希并存储');
      addCryptoLog('ZKP', '零知识证明', '成功', '端侧ZKP证明生成成功');

      CreditProofCache.setProof(responseData.data.proof, user.id);

      window.dispatchEvent(new CustomEvent('creditProofGenerated', {
        detail: responseData.data.proof
      }));
    } catch (err) {
      setError(err.message);
      setZkStatus('');
      addCryptoLog('SM2签名', '信用证明生成', '失败', `生成信用证明失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyProof = async () => {
    try {
      setLoading(true);
      setError('');
      setSuccess('');
      
      // 记录信用证明验证开始
      addCryptoLog('验证', '信用证明验证', '发起', '准备验证信用证明签名和哈希');
      
      const response = await post('/api/v1/credit/verify-proof', {
        proof,
        verificationCode,
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message || '验证信用证明失败');
      }

      setSuccess('信用证明验证成功！');
      
      // 记录信用证明验证成功
      addCryptoLog('验证', '信用证明验证', '成功', 'SM2签名验证通过，SM3哈希匹配');
    } catch (err) {
      setError(err.message);
      // 记录信用证明验证失败
      addCryptoLog('验证', '信用证明验证', '失败', `验证信用证明失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(
      () => {
        setSuccess('验证码已复制到剪贴板');
      },
      () => {
        setError('复制失败，请手动复制');
      }
    );
  };

  // 显示验证码有效期
  const getExpiryTime = () => {
    if (!proof) return '';
    const expiryDate = new Date(proof.expiresAt);
    return expiryDate.toLocaleString('zh-CN');
  };

  if (!user) {
    navigate('/');
    return null;
  }

  return (
    <Container maxWidth="md" sx={{ mt: 4 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        信用证明
      </Typography>

      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                用户信息
              </Typography>
              <Box sx={{ mb: 2 }}>
                <Typography variant="body1">
                  用户名: {user.username}
                </Typography>
                <Typography variant="body1">
                  信用分数: {user.creditScore}
                </Typography>
              </Box>
              <Button
                variant="contained"
                color="primary"
                onClick={handleGenerateProof}
                disabled={loading || !zkWorkerReady}
                fullWidth
              >
                {loading ? <CircularProgress size={24} /> : (zkStatus || '生成信用证明')}
              </Button>
              {zkStatus && !loading && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                  {zkStatus}
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                信用证明验证
              </Typography>
              {proof && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    证明ID: {proof.id}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    生成时间: {new Date(proof.timestamp).toLocaleString()}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    有效期至: {getExpiryTime()}
                  </Typography>
                  <Paper sx={{ p: 2, mt: 2, bgcolor: 'grey.100' }}>
                    <Typography variant="subtitle2" gutterBottom>
                      验证码
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="body1" sx={{ fontFamily: 'monospace' }}>
                        {verificationCode}
                      </Typography>
                      <IconButton
                        size="small"
                        onClick={() => copyToClipboard(verificationCode)}
                        title="复制验证码"
                      >
                        <ContentCopyIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  </Paper>
                </Box>
              )}
              <TextField
                fullWidth
                label="验证码"
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value)}
                margin="normal"
                disabled={!proof}
              />
              <Button
                variant="contained"
                color="primary"
                onClick={handleVerifyProof}
                disabled={loading || !proof}
                fullWidth
                sx={{ mt: 2 }}
              >
                {loading ? <CircularProgress size={24} /> : '验证信用证明'}
              </Button>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {error}
        </Alert>
      )}
      
      {success && (
        <Alert severity="success" sx={{ mt: 2 }}>
          {success}
        </Alert>
      )}

      {/* 信用历史记录 */}
      <Box sx={{ mt: 4 }}>
        <Typography variant="h5" gutterBottom>
          信用历史记录
        </Typography>
        {creditHistory.length > 0 ? (
          <Card>
            <CardContent>
              {creditHistory.map((item, index) => (
                <Box key={index} sx={{ mb: 2, p: 2, borderBottom: index < creditHistory.length - 1 ? '1px solid #e0e0e0' : 'none' }}>
                  <Typography variant="body1">
                    {new Date(item.timestamp).toLocaleString()}
                  </Typography>
                  <Typography variant="body1" sx={{ fontWeight: 'bold' }}>
                    信用分: {item.score} ({item.change > 0 ? '+' : ''}{item.change})
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {item.description}
                  </Typography>
                </Box>
              ))}
            </CardContent>
          </Card>
        ) : (
          <Typography variant="body2" color="text.secondary">
            暂无信用历史记录
          </Typography>
        )}
      </Box>
    </Container>
  );
};

export default CreditProof; 