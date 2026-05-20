import React, { useState, useEffect } from 'react';
import { useAesKey } from '../App';
import {
  Container,
  Typography,
  Paper,
  Box,
  TextField,
  Button,
  Grid,
  Card,
  CardContent,
  Alert,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Chip,
  Tooltip,
} from '@mui/material';
import { signWithSM2, getSM2KeyPair, saveSM2KeyPair, generateSM2KeyPair, generateSignatureData, generateSignatureDataStrict, getSM2KeyPairWithAesKey } from '../utils/sm2Utils';
import { post, get } from '../utils/apiUtils';
import { syncLogToBackend } from '../utils/logUtils';

const RedeemPage = ({ user, cryptoLogs, setCryptoLogs }) => {
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [showVerificationDialog, setShowVerificationDialog] = useState(false);
  const [latestProof, setLatestProof] = useState(null);
  const [userData, setUserData] = useState(null);
  const [investments, setInvestments] = useState([]);
  const [redeemableAmount, setRedeemableAmount] = useState(0);
  const [liquidityInfo, setLiquidityInfo] = useState(null);
  const [showChallengeDialog, setShowChallengeDialog] = useState(false);
  const [challengeData, setChallengeData] = useState(null);
  const [pendingRedeemData, setPendingRedeemData] = useState(null);

  useEffect(() => {
    fetchUserData();
    fetchLatestCreditProof();
    fetchInvestments();
    fetchRedeemableAmount();
    
    // 监听刷新事件
    const handleRefresh = () => {
      fetchUserData();
      fetchInvestments();
      fetchRedeemableAmount();
    };
    
    window.addEventListener('refreshRedeemData', handleRefresh);
    
    // 清理事件监听器
    return () => {
      window.removeEventListener('refreshRedeemData', handleRefresh);
    };
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
        if (data.message !== 'No credit proof found') {
          setError('获取信用证明失败: ' + (data.message || '未知错误'));
        }
        setLatestProof(null);
      }
    } catch (err) {
      console.error('获取信用证明失败:', err);
      setError('网络错误，无法获取信用证明');
      setLatestProof(null);
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

  const fetchInvestments = async () => {
    try {
      // 获取出资列表
      const response = await get(`/api/v1/invest/${user.id}`);
      const data = await response.json();
      if (data.success) {
        setInvestments(data.investments);
      } else {
        setError('获取出资数据失败: ' + (data.message || '未知错误'));
        setInvestments([]);
      }
    } catch (err) {
      console.error('获取出资数据失败:', err);
      setError('网络错误，无法获取出资数据');
      setInvestments([]);
    }
  };

  const fetchRedeemableAmount = async () => {
    try {
      // 从资金池API获取可赎回金额
      const response = await get(`/api/v1/pool/my-invest/${user.id}`);
      const data = await response.json();
      if (data.success && data.data) {
        const redeemableValue = data.data.maxRedeemAmount || 0;
        setRedeemableAmount(redeemableValue);
        // 存储流动性策略信息
        if (data.data.liquidity) {
          setLiquidityInfo(data.data.liquidity);
        } else {
          // API返回成功但无流动性数据，使用默认值
          setLiquidityInfo({
            ratio: 0,
            tier: 'low',
            earlyRedeemRatio: 0,
            totalImmaturedActive: 0,
            totalEligible: 0
          });
        }
      } else {
        // 如果没有出资记录，设置可赎回金额为0
        setRedeemableAmount(0);
        setLiquidityInfo({
          ratio: 0,
          tier: 'low',
          earlyRedeemRatio: 0,
          totalImmaturedActive: 0,
          totalEligible: 0
        });
        if (data.message !== '用户没有出资记录') {
          setError('获取可赎回金额失败: ' + (data.message || '未知错误'));
        }
      }
    } catch (err) {
      console.error('获取可赎回金额失败:', err);
      setError('网络错误，无法获取可赎回金额');
      setRedeemableAmount(0);
      setLiquidityInfo({
        ratio: 0,
        tier: 'low',
        earlyRedeemRatio: 0,
        totalImmaturedActive: 0,
        totalEligible: 0
      });
    }
  };

  const handleRedeem = async () => {
    // 验证金额是否为有效数字
    const redeemAmount = parseFloat(amount);
    if (isNaN(redeemAmount) || redeemAmount <= 0) {
      setError('请输入有效的赎回金额');
      return;
    }

    // 实时获取最新的可赎回金额
    await fetchRedeemableAmount();
    
    if (redeemAmount > redeemableAmount) {
      setError(`赎回金额不能超过可赎回金额 ¥${(Number(redeemableAmount) || 0).toFixed(2)}`);
      return;
    }

    if (!latestProof) {
      setError('请先生成信用证明');
      return;
    }

    setShowVerificationDialog(true);
  };

  // 全部赎回功能
  const handleRedeemAll = async () => {
    if (redeemableAmount <= 0) {
      setError('没有可赎回金额');
      return;
    }
    setAmount(redeemableAmount.toString());
  };

  const handleConfirmRedeem = async () => {
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
      // 记录赎回发起日志
      addCryptoLog({
        operationType: 'SM2签名',
        description: '赎回发起',
        status: '待验证',
        detail: `申请赎回金额: ${amount}元`,
        correlationInfo: {
          userId: user.id,
          amount: parseInt(amount)
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
      const redeemData = {
        userId: user.id.toString(),
        amount: parseInt(amount),
        creditProofId: latestProof.id
      };
      
      // 生成签名
      const signatureData = generateSignatureDataStrict(redeemData, ['amount', 'creditProofId', 'userId']);
      const signature = signWithSM2(signatureData, keyPair.privateKey);

      // 保存原始签名和请求数据，供大额赎回二次提交使用
      const redeemRequestData = {
        userId: user.id,
        amount: parseInt(amount),
        creditProof: latestProof,
        verificationCode,
        signature
      };
      setPendingRedeemData(redeemRequestData);

      const response = await post('/api/v1/redeem', redeemRequestData);

      const data = await response.json();

      if (data.requireChallenge) {
        setChallengeData({
          challengeId: data.challengeId,
          challengeCode: data.challengeCode,
        });
        setShowChallengeDialog(true);
        setLoading(false);
        return;
      }

      if (data.success) {
        // 记录赎回成功日志
        addCryptoLog({
          operationType: 'SM2签名',
          description: '赎回验证',
          status: '成功',
          detail: '后端用SM2公钥验证赎回签名通过',
          correlationInfo: {
            userId: user.id,
            amount: parseInt(amount),
            redeemId: data.redeemId
          }
        });

        addCryptoLog({
          operationType: 'SM3哈希',
          description: '赎回记录哈希',
          status: '成功',
          detail: `生成赎回记录SM3哈希: ${data.hash ? data.hash.substring(0, 8) + '...' : '未知'}`,
          correlationInfo: {
            userId: user.id,
            redeemId: data.redeemId
          }
        });

        addCryptoLog({
          operationType: '哈希链',
          description: '哈希链更新',
          status: '成功',
          detail: '赎回记录已添加到哈希链，资金安全返还',
          correlationInfo: {
            userId: user.id,
            redeemId: data.redeemId
          }
        });

        setSuccess('赎回成功！');
        setAmount('');
        setVerificationCode('');
        setShowVerificationDialog(false);
        // 刷新数据
        setTimeout(() => {
          fetchUserData();
          fetchInvestments();
          fetchRedeemableAmount();
          // 通知资金池页面刷新数据
          window.dispatchEvent(new CustomEvent('refreshPoolData'));
        }, 500);
      } else {
        // 记录赎回失败日志
        addCryptoLog({
          operationType: 'SM2签名',
          description: '赎回失败',
          status: '失败',
          detail: data.message || '赎回失败',
          correlationInfo: {
            userId: user.id,
            amount: parseInt(amount)
          }
        });
        setError(data.message || '赎回失败');
      }
    } catch (err) {
      // 记录赎回异常日志
      addCryptoLog({
        operationType: 'SM2签名',
        description: '赎回异常',
        status: '失败',
        detail: err.message || '网络错误，请稍后重试',
        correlationInfo: {
          userId: user.id,
          amount: parseInt(amount)
        }
      });
      setError(err.message || '网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const handleChallengeConfirm = async () => {
    if (!aesKey) {
      setError('AES密钥不存在，请重新登录');
      return;
    }

    setLoading(true);
    setError('');
    setShowChallengeDialog(false);

    try {
      const keyPair = await getSM2KeyPairWithAesKey(aesKey);
      if (!keyPair?.privateKey) {
        throw new Error('无法获取SM2密钥对');
      }

      const challengeSignature = signWithSM2(
        challengeData.challengeCode,
        keyPair.privateKey
      );
      keyPair.privateKey = null;

      const response = await post('/api/v1/redeem', {
        ...pendingRedeemData,
        challengeId: challengeData.challengeId,
        challengeSignature: challengeSignature
      });

      const data = await response.json();
      if (data.success) {
        setSuccess('赎回成功！');
        setAmount('');
        setVerificationCode('');
        setShowVerificationDialog(false);
        setPendingRedeemData(null);
        setChallengeData(null);
        setTimeout(() => {
          fetchUserData();
          fetchInvestments();
          fetchRedeemableAmount();
          window.dispatchEvent(new CustomEvent('refreshPoolData'));
        }, 500);
      } else {
        setError(data.message || '赎回失败');
      }
    } catch (err) {
      setError(err.message || '二次签名失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container maxWidth="md" sx={{ mt: 4 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        赎回管理
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
              <Typography variant="body1" sx={{ mb: 1 }}>
                可赎回金额：¥{(Number(redeemableAmount) || 0).toFixed(2)}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                流动性策略
              </Typography>
              {liquidityInfo ? (
                <Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <Typography variant="body2" color="text.secondary">
                      池可用率：
                    </Typography>
                    <Typography variant="body1" fontWeight="bold"
                      color={liquidityInfo.ratio >= 60 ? 'success.main' : liquidityInfo.ratio >= 40 ? 'warning.main' : 'error.main'}>
                      {liquidityInfo.ratio}%
                    </Typography>
                    <Chip
                      size="small"
                      label={liquidityInfo.tier === 'high' ? '高档' : liquidityInfo.tier === 'medium' ? '中档' : '低档'}
                      color={liquidityInfo.tier === 'high' ? 'success' : liquidityInfo.tier === 'medium' ? 'warning' : 'error'}
                    />
                  </Box>
                  <Box sx={{ mt: 1, p: 1.5, backgroundColor: '#f5f5f5', borderRadius: 1 }}>
                    <Typography variant="body2" fontWeight="medium" gutterBottom>
                      当前赎回规则：
                    </Typography>
                    {liquidityInfo.tier === 'high' && (
                      <Typography variant="body2" color="text.secondary">
                        池可用率 ≥ 60%，所有投资（含未到期）均可全额赎回。
                      </Typography>
                    )}
                    {liquidityInfo.tier === 'medium' && (
                      <Typography variant="body2" color="text.secondary">
                        池可用率 40%~60%，已到期投资全额可赎，未到期投资最多赎回 50%。
                      </Typography>
                    )}
                    {liquidityInfo.tier === 'low' && (
                      <Typography variant="body2" color="text.secondary">
                        池可用率 &lt; 40%，仅已到期投资可赎回，未到期投资暂不可赎。
                      </Typography>
                    )}
                  </Box>
                  <Box component="ul" sx={{ pl: 2, mt: 1, mb: 0 }}>
                    <Typography component="li" variant="body2" color="text.secondary">
                      优先赎回利息部分
                    </Typography>
                    <Typography component="li" variant="body2" color="text.secondary">
                      再赎回非当日本金
                    </Typography>
                    <Typography component="li" variant="body2" color="text.secondary">
                      当日本金不计当日利息
                    </Typography>
                  </Box>
                </Box>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  加载中...
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              赎回信息
            </Typography>

            <Box sx={{ mb: 3 }}>
              <TextField
                fullWidth
                label="赎回金额"
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={loading}
                sx={{ mb: 2 }}
                inputProps={{ min: 0, step: 1 }}
              />

              <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                <Button
                  variant="outlined"
                  color="primary"
                  onClick={handleRedeemAll}
                  disabled={loading || redeemableAmount <= 0}
                  fullWidth
                >
                  全部赎回
                </Button>
              </Box>

              {!latestProof && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  请先在"信用证明"页面生成信用证明
                </Alert>
              )}

              <Button
                variant="contained"
                color="primary"
                onClick={handleRedeem}
                disabled={loading || !amount || !latestProof}
                fullWidth
              >
                {loading ? <CircularProgress size={24} /> : '确认赎回'}
              </Button>
            </Box>

            <Box sx={{ mt: 2 }}>
              <Typography variant="h6" gutterBottom>
                出资列表
              </Typography>
              {investments.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  暂无出资记录
                </Typography>
              ) : (
                <Box sx={{ mt: 2 }}>
                  {investments.map((investment, index) => {
                    const isMatured = investment.maturityDate ? new Date(investment.maturityDate).getTime() <= Date.now() : true;
                    const isTodayInvestment = new Date(investment.timestamp).toDateString() === new Date().toDateString();
                    const isActive = investment.status === 'active';

                    // 根据流动性档位判断未到期投资的可赎状态
                    let canEarlyRedeem = false;
                    let earlyRedeemLabel = '';
                    if (isActive && !isMatured && liquidityInfo) {
                      if (liquidityInfo.tier === 'high') {
                        canEarlyRedeem = true;
                        earlyRedeemLabel = '高档-全额可提前赎';
                      } else if (liquidityInfo.tier === 'medium') {
                        canEarlyRedeem = true;
                        earlyRedeemLabel = '中档-最多提前赎50%';
                      }
                    }

                    const isRedeemable = isActive && (isMatured || canEarlyRedeem);
                    const borderColor = isMatured && isActive ? '#4caf50' : canEarlyRedeem ? '#ff9800' : '#9e9e9e';

                    let statusText, statusColor;
                    if (!isActive) {
                      statusText = investment.status;
                      statusColor = 'text.secondary';
                    } else if (isMatured) {
                      statusText = '已到期-可赎回';
                      statusColor = 'success.main';
                    } else if (canEarlyRedeem) {
                      statusText = earlyRedeemLabel;
                      statusColor = 'warning.main';
                    } else {
                      statusText = '未到期-暂不可赎';
                      statusColor = 'text.secondary';
                    }

                    return (
                    <Card key={index} sx={{ mb: 2, borderLeft: `4px solid ${borderColor}` }}>
                      <CardContent>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                          <Box>
                            <Typography variant="subtitle1">
                              出资金额：¥{(Number(investment.amount) || 0).toFixed(2)}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              出资日期：{new Date(investment.timestamp).toLocaleString()}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              到期日期：{new Date(investment.maturityDate).toLocaleString()}
                            </Typography>
                            {isTodayInvestment && (
                              <Typography variant="body2" color="warning.main">
                                当日本金，不计当日利息
                              </Typography>
                            )}
                          </Box>
                          <Box sx={{ textAlign: 'right' }}>
                            <Typography variant="body2" color={statusColor} fontWeight="medium">
                              {statusText}
                            </Typography>
                            {canEarlyRedeem && !isMatured && (
                              <Tooltip title={`池可用率 ${liquidityInfo.ratio}%，当前${liquidityInfo.tier === 'high' ? '高档允许全额提前赎回' : '中档允许50%提前赎回'}`}>
                                <Chip size="small" label="可提前赎回" color="warning" sx={{ mt: 0.5 }} />
                              </Tooltip>
                            )}
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                              预期收益：¥{(Number(investment.expectedReturn) || 0).toFixed(2)}
                            </Typography>
                          </Box>
                        </Box>
                      </CardContent>
                    </Card>
                    );
                  })}
                </Box>
              )}
            </Box>
          </Paper>
        </Grid>
      </Grid>

      <Dialog open={showVerificationDialog} onClose={() => setShowVerificationDialog(false)}>
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
          <Button onClick={() => setShowVerificationDialog(false)}>取消</Button>
          <Button
            onClick={handleConfirmRedeem}
            variant="contained"
            disabled={loading || !verificationCode}
          >
            {loading ? <CircularProgress size={24} /> : '确认赎回'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={showChallengeDialog} onClose={() => { setShowChallengeDialog(false); setLoading(false); }}>
        <DialogTitle>大额赎回二次确认</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            赎回金额超过 ¥10,000，需要进行二次签名确认。
          </Typography>
          <Alert severity="info" sx={{ mb: 2 }}>
            这是您在本次操作中的唯一挑战码，请确认后签名。
          </Alert>
          <Typography variant="body2" color="text.secondary">
            挑战码：{challengeData?.challengeCode?.substring(0, 32)}...
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setShowChallengeDialog(false); setLoading(false); }}>取消</Button>
          <Button onClick={handleChallengeConfirm} variant="contained" color="primary">
            签名确认
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

export default RedeemPage;