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
  Paper,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  MenuItem
} from '@mui/material';
import { signWithSM2, getSM2KeyPair, saveSM2KeyPair, generateSM2KeyPair, generateSignatureData, generateSignatureDataStrict, getSM2KeyPairWithAesKey } from '../utils/sm2Utils';
import { post, get } from '../utils/apiUtils';
import { syncLogToBackend } from '../utils/logUtils';

const InvestPage = ({ user, cryptoLogs, setCryptoLogs }) => {
  const aesKey = useAesKey();
  // 添加密码操作日志
  const addCryptoLog = (logData) => {
    const newLog = {
      id: Date.now() + Math.random().toString(36).substr(2, 9),
      userId: user?.id || 'unknown',
      timestamp: new Date().toLocaleString('zh-CN'),
      fullTimestamp: new Date().toISOString(),
      ...logData
    };
    
    setCryptoLogs(prevLogs => {
      const updatedLogs = [newLog, ...prevLogs];
      // 最多保留50条日志
      return updatedLogs.slice(0, 50);
    });

    syncLogToBackend(newLog);
  };
  const [amount, setAmount] = useState('');
  const [term, setTerm] = useState(30);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [showVerificationDialog, setShowVerificationDialog] = useState(false);
  const [latestProof, setLatestProof] = useState(null);
  const [userData, setUserData] = useState(null);

  useEffect(() => {
    fetchUserData();
    fetchLatestCreditProof();
  }, [user]);

  const fetchUserData = async () => {
    try {
      const response = await get(`/api/v1/users/${user.id}`);
      const data = await response.json();
      if (data.success) {
        setUserData(data.user);
      } else {
        setError('获取用户数据失败: ' + (data.message || '未知错误'));
      }
    } catch (err) {
      console.error('获取用户数据失败:', err);
      setError('网络错误，无法获取用户数据');
    }
  };

  const fetchLatestCreditProof = async () => {
    try {
      const response = await get(`/api/v1/credit/${user.id}`);
      const data = await response.json();
      if (data.success) {
        setLatestProof(data.data.proof);
      } else {
        // 信用证明不存在不是错误，只是没有证明
        if (data.message !== 'No credit proof found') {
          setError('获取信用证明失败: ' + (data.message || '未知错误'));
        }
      }
    } catch (err) {
      console.error('获取信用证明失败:', err);
      setError('网络错误，无法获取信用证明');
    }
  };

  // 监听信用证明生成事件
  useEffect(() => {
    const handleCreditProofGenerated = (event) => {
      console.log('Credit proof generated event received:', event.detail);
      setLatestProof(event.detail);
    };

    window.addEventListener('creditProofGenerated', handleCreditProofGenerated);

    return () => {
      window.removeEventListener('creditProofGenerated', handleCreditProofGenerated);
    };
  }, []);

  const calculateExpectedReturn = (amount, term) => {
    // 简单的收益计算模型
    const annualRate = 0.08; // 8%年利率
    const dailyRate = annualRate / 365;
    return amount * dailyRate * term;
  };

  const handleInvest = async () => {
    if (!amount || amount <= 0) {
      setError('请输入有效的出资金额');
      return;
    }

    if (!latestProof) {
      setError('请先生成信用证明');
      return;
    }

    // 检查账户余额
    if (userData && parseFloat(amount) > userData.balance) {
      setError(`账户余额不足，当前余额: ¥${(Number(userData.balance) || 0).toFixed(2)}`);
      return;
    }

    setShowVerificationDialog(true);
  };

  const handleConfirmInvest = async () => {
    if (!verificationCode) {
      setError('请输入验证口令');
      return;
    }

    // 检查AES密钥是否存在
    if (!aesKey) {
      setError('AES密钥不存在，请重新登录');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      // 记录出资发起日志
      addCryptoLog({
        operationType: 'SM2签名',
        description: '出资发起',
        status: '待验证',
        detail: `申请出资金额: ${amount}元，期限: ${term}天`,
        correlationInfo: {
          userId: user.id,
          amount: parseInt(amount),
          term: term
        }
      });

      // 检查是否有SM2密钥对，如果没有则生成
      let keyPair = await getSM2KeyPairWithAesKey(aesKey);
      if (!keyPair) {
        const newKeyPair = generateSM2KeyPair();
        // 新密钥对生成后，立即用当前 aesKey 加密保存
        await saveSM2KeyPair(newKeyPair, aesKey);
        keyPair = newKeyPair; // 确保后续签名使用的是新密钥对
      }
      
      // 准备签名数据
      const investmentData = {
        userId: user.id.toString(),
        amount: parseInt(amount),
        term: term,
        creditProofId: latestProof.id
      };
      
      // 生成签名
      const signatureData = generateSignatureDataStrict(investmentData, ['amount', 'creditProofId', 'term', 'userId']);
      const signature = signWithSM2(signatureData, keyPair.privateKey);
      
      // 立即销毁私钥
      keyPair.privateKey = null;
      
      const response = await post('/api/v1/invest', {
        userId: user.id,
        amount: parseInt(amount),
        term: term,
        creditProof: latestProof,
        verificationCode,
        signature
      });

      const data = await response.json();

      if (data.success) {
        // 记录出资成功日志
        addCryptoLog({
          operationType: 'SM3哈希',
          description: '出资关联哈希',
          status: '成功',
          detail: `关联借款记录SM3哈希: ${data.hash ? data.hash.substring(0, 8) + '...' : '未知'}`,
          correlationInfo: {
            userId: user.id,
            investmentId: data.investmentId
          }
        });

        addCryptoLog({
          operationType: 'SM2签名',
          description: '出资签名',
          status: '成功',
          detail: '生成出资请求SM2签名并验证通过',
          correlationInfo: {
            userId: user.id,
            investmentId: data.investmentId
          }
        });

        addCryptoLog({
          operationType: '哈希链',
          description: '哈希链存证',
          status: '成功',
          detail: '出资记录与借款记录形成哈希链，存证完成',
          correlationInfo: {
            userId: user.id,
            investmentId: data.investmentId
          }
        });

        setSuccess('出资成功！');
        setAmount('');
        setVerificationCode('');
        setShowVerificationDialog(false);
        // 刷新数据
        setTimeout(() => {
          fetchUserData();
          // 通知资金池页面刷新数据
          window.dispatchEvent(new CustomEvent('refreshPoolData'));
          // 通知赎回页面刷新数据
          window.dispatchEvent(new CustomEvent('refreshRedeemData'));
        }, 500);
      } else {
        // 记录出资失败日志
        addCryptoLog({
          operationType: 'SM2签名',
          description: '出资失败',
          status: '失败',
          detail: data.message || '出资失败',
          correlationInfo: {
            userId: user.id,
            amount: parseInt(amount),
            term: term
          }
        });
        setError(data.message || '出资失败');
      }
    } catch (err) {
      // 记录出资异常日志
      addCryptoLog({
        operationType: 'SM2签名',
        description: '出资异常',
        status: '失败',
        detail: err.message || '网络错误，请稍后重试',
        correlationInfo: {
          userId: user.id,
          amount: parseInt(amount),
          term: term
        }
      });
      setError(err.message || '网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container maxWidth="md" sx={{ mt: 4 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        出资管理
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {success}
        </Alert>
      )}

      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                账户信息
              </Typography>
              <Typography variant="body1" sx={{ mb: 1 }}>
                当前余额：¥{(userData?.balance || 0).toFixed(2)}
              </Typography>
              <Typography variant="body1" sx={{ mb: 1 }}>
                信用评分：{userData?.creditScore || 0}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                预期收益
              </Typography>
              <Typography variant="body1" sx={{ mb: 1 }}>
                出资金额：¥{amount || 0}
              </Typography>
              <Typography variant="body1" sx={{ mb: 1 }}>
                出资期限：{term}天
              </Typography>
              <Typography variant="h5" color="primary">
                预期收益：¥{calculateExpectedReturn(parseFloat(amount) || 0, term).toFixed(2)}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              出资信息
            </Typography>

            <Box sx={{ mb: 3 }}>
              <TextField
                fullWidth
                label="出资金额"
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={loading}
                sx={{ mb: 2 }}
              />

              <TextField
                fullWidth
                label="出资期限（天）"
                type="number"
                value={term}
                onChange={(e) => setTerm(parseInt(e.target.value) || 30)}
                disabled={loading}
                sx={{ mb: 2 }}
              />

              {!latestProof && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  请先在"信用证明"页面生成信用证明
                </Alert>
              )}

              <Button
                variant="contained"
                color="primary"
                onClick={handleInvest}
                disabled={loading || !amount || !latestProof}
                fullWidth
              >
                {loading ? <CircularProgress size={24} /> : '确认出资'}
              </Button>
            </Box>

            <Box sx={{ mt: 2 }}>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                提示：
              </Typography>
              <Box component="ul" sx={{ pl: 2, mt: 0 }}>
                <Typography component="li" variant="body2" color="text.secondary">
                  出资前请先在"信用证明"页面生成验证口令
                </Typography>
                <Typography component="li" variant="body2" color="text.secondary">
                  验证口令有效期为24小时
                </Typography>
                <Typography component="li" variant="body2" color="text.secondary">
                  出资收益将在到期后自动结算
                </Typography>
                <Typography component="li" variant="body2" color="text.secondary">
                  提前赎回将收取一定手续费
                </Typography>
              </Box>
            </Box>
          </Paper>
        </Grid>
      </Grid>

      <Dialog open={showVerificationDialog} onClose={() => { setShowVerificationDialog(false); setVerificationCode(''); }}>
        <DialogTitle>验证信用证明</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            请输入从"信用证明"页面获取的验证口令：
          </Typography>
          <TextField
            fullWidth
            label="验证口令"
            value={verificationCode}
            onChange={(e) => setVerificationCode(e.target.value)}
            disabled={loading}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setShowVerificationDialog(false); setVerificationCode(''); }}>取消</Button>
          <Button
            onClick={handleConfirmInvest}
            variant="contained"
            disabled={loading || !verificationCode}
          >
            {loading ? <CircularProgress size={24} /> : '确认出资'}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

export default InvestPage;