import React, { useState, useEffect } from 'react';
import { useAesKey } from '../App';
import {
  Container,
  Typography,
  TextField,
  Button,
  Paper,
  Box,
  Alert,
  CircularProgress,
  Card,
  CardContent,
  Grid,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TableContainer,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell
} from '@mui/material';
import { generateProof } from '../utils/zkUtils';
import { signWithSM2, getSM2KeyPair, saveSM2KeyPair, generateSM2KeyPair, generateSignatureData, generateSignatureDataStrict, getSM2KeyPairWithAesKey } from '../utils/sm2Utils';
import { post, get } from '../utils/apiUtils';
import { syncLogToBackend } from '../utils/logUtils';

const getRemainingLoanLimit = (loanConfig, loans, user = null) => {
  if (!loanConfig) return 0;

  let effectiveLimit = loanConfig.maxLoanLimit;

  // 冷静期检查：注册后指定天数内额度按比例缩减
  if (user?.created_at && loanConfig.coolingOff) {
    const registerDate = new Date(user.created_at);
    const daysSinceRegister = Math.floor((Date.now() - registerDate) / (24 * 60 * 60 * 1000));
    if (daysSinceRegister < loanConfig.coolingOff.days) {
      effectiveLimit = Math.floor(loanConfig.maxLoanLimit * loanConfig.coolingOff.ratio);
    }
  }

  const totalBorrowed = loans
    .filter(loan => loan.status === 'pending')
    .reduce((sum, loan) => sum + (Number(loan.amount) || 0), 0);
  return Math.max(0, effectiveLimit - totalBorrowed);
};

const Borrow = ({ user, cryptoLogs, setCryptoLogs }) => {
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

    // 同步到后端持久化
    syncLogToBackend(newLog);
  };
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [showVerificationDialog, setShowVerificationDialog] = useState(false);
  const [creditProof, setCreditProof] = useState(null);
  const [userData, setUserData] = useState(null);
  const [allLoans, setAllLoans] = useState([]);
  const [showRepayDialog, setShowRepayDialog] = useState(false);
  const [repayTransactionId, setRepayTransactionId] = useState(null);
  const [repayLoading, setRepayLoading] = useState(false);
  const [repayVerificationCode, setRepayVerificationCode] = useState('');
  const [repayAmount, setRepayAmount] = useState('');
  const [poolInfo, setPoolInfo] = useState(null);
  const [showChallengeDialog, setShowChallengeDialog] = useState(false);
  const [challengeData, setChallengeData] = useState(null);
  const [pendingBorrowData, setPendingBorrowData] = useState(null);
  const [term, setTerm] = useState(30);
  const [loanConfig, setLoanConfig] = useState(null);

  // 获取用户数据和借款配置
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch user data
        const userResponse = await get(`/api/v1/users/${user.id}`);
        const userData = await userResponse.json();
        if (userData.success) {
          setUserData(userData.user);
        }

        // Fetch loan config
        const configResponse = await get(`/api/v1/loan/config/${user.id}`);
        const configData = await configResponse.json();
        if (configData.success) {
          setLoanConfig(configData.data);
        }

        // Fetch user transactions (loans)
        const transactionsResponse = await get(`/api/v1/loan/transactions/${user.id}`);
        const transactionsData = await transactionsResponse.json();
        if (transactionsData.success) {
          // Filter only loan transactions
          const loans = transactionsData.transactions.filter(t => t.type === 'loan');
          setAllLoans(loans);
        }

        // Fetch pool information
        const poolResponse = await get('/api/v1/pool');
        const poolData = await poolResponse.json();
        if (poolData.success) {
          setPoolInfo(poolData.pool);
        }
      } catch (err) {
        console.error('Error fetching data:', err);
        setError('获取数据失败');
      }
    };

    if (user) {
      fetchData();
    }
  }, [user]);

  // 获取最新的信用证明
  const fetchLatestCreditProof = async () => {
    try {
      console.log('Fetching credit proof for user:', user.id);
      const response = await get(`/api/v1/credit/${user.id}`);
      const data = await response.json();
      console.log('Credit proof response:', data);
      if (data.success) {
        setCreditProof(data.data.proof);
        console.log('Credit proof set:', data.data.proof);
      } else {
        console.log('Failed to get credit proof:', data.message);
      }
    } catch (err) {
      console.error('获取信用证明失败:', err);
    }
  };

  useEffect(() => {
    if (user) {
      fetchLatestCreditProof();
    }
  }, [user]);

  // 监听信用证明生成事件
  useEffect(() => {
    const handleCreditProofGenerated = (event) => {
      console.log('Credit proof generated event received:', event.detail);
      setCreditProof(event.detail);
    };

    window.addEventListener('creditProofGenerated', handleCreditProofGenerated);

    return () => {
      window.removeEventListener('creditProofGenerated', handleCreditProofGenerated);
    };
  }, []);

  const handleBorrow = async () => {
    if (!amount || amount <= 0) {
      setError('请输入有效的借款金额');
      return;
    }

    if (!creditProof) {
      setError('请先生成信用证明');
      return;
    }

    // 检查可借余额
    const remainingLimit = getRemainingLoanLimit(loanConfig, allLoans, userData);
    if (remainingLimit <= 0) {
      setError('您的可借余额为0，无法发起借款');
      return;
    }

    if (parseFloat(amount) > remainingLimit) {
      setError(`借款金额不能超过可借余额 ¥${remainingLimit.toFixed(2)}`);
      return;
    }

    setShowVerificationDialog(true);
  };

  const handleConfirmBorrow = async () => {
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
      // 记录借款发起日志
      addCryptoLog({
        operationType: 'SM2签名',
        description: '借款发起',
        status: '待验证',
        detail: `申请借款金额: ${amount}元，期限: ${term}天`,
        correlationInfo: {
          userId: user.id,
          amount: parseInt(amount),
          term
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
      
      // 生成零知识证明
      const creditScore = Number(userData?.creditScore || creditProof?.creditScore || 0);
      if (creditScore < 600) {
        setError('信用评分不足，无法借款');
        setLoading(false);
        return;
      }
      const { proof, publicSignals } = await generateProof(creditScore, 600, user.id);
      
      // 准备信用证明数据，包含零知识证明
      const creditProofWithZKP = {
        ...creditProof,
        proof,
        publicSignals
      };
      
      // 准备签名数据
      const transactionData = {
        userId: user.id.toString(),
        amount: parseInt(amount),
        creditProofId: creditProof.id
      };
      
      // 生成签名
      const signatureData = generateSignatureDataStrict(transactionData, ['amount', 'creditProofId', 'userId']);
      const signature = signWithSM2(signatureData, keyPair.privateKey);

      // 保存原始签名和请求数据，供大额借款二次提交使用
      const borrowData = {
        userId: user.id,
        amount: parseInt(amount),
        creditProof: creditProofWithZKP,
        verificationCode,
        signature,
        term
      };
      setPendingBorrowData(borrowData);

      const response = await post('/api/v1/loan/borrow', borrowData);

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
        // 记录借款成功日志
        addCryptoLog({
          operationType: 'SM2签名',
          description: '借款通过',
          status: '成功',
          detail: '后端用SM2公钥验证签名通过',
          correlationInfo: {
            userId: user.id,
            amount: parseInt(amount),
            transactionId: data.transactionId
          }
        });

        addCryptoLog({
          operationType: 'SM3哈希',
          description: '借款记录哈希',
          status: '成功',
          detail: `生成借款记录SM3哈希: ${data.hash ? data.hash.substring(0, 8) + '...' : '未知'}`,
          correlationInfo: {
            userId: user.id,
            transactionId: data.transactionId
          }
        });

        setSuccess('借款申请成功！');
        setAmount('');
        setVerificationCode('');
        setShowVerificationDialog(false);
        // 刷新用户数据和借款记录
        setTimeout(() => {
          refreshUserData();
          // 通知其他页面刷新数据
          window.dispatchEvent(new CustomEvent('refreshUserData'));
          window.dispatchEvent(new CustomEvent('refreshPoolData'));
        }, 500);
      } else {
        // 记录借款失败日志
        addCryptoLog({
          operationType: 'SM2签名',
          description: '借款失败',
          status: '失败',
          detail: data.message || '借款失败',
          correlationInfo: {
            userId: user.id,
            amount: parseInt(amount)
          }
        });
        setError(data.message || '借款失败');
      }
    } catch (err) {
      // 记录借款异常日志
      addCryptoLog({
        operationType: 'SM2签名',
        description: '借款异常',
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

  const refreshUserData = async () => {
    try {
      // 刷新用户数据
      const userResponse = await get(`/api/v1/users/${user.id}`);
      const userData = await userResponse.json();
      if (userData.success) {
        setUserData(userData.user);
      }
      // 刷新借款配置
      const configResponse = await get(`/api/v1/loan/config/${user.id}`);
      const configData = await configResponse.json();
      if (configData.success) {
        setLoanConfig(configData.data);
      }
      // 刷新借款记录
      const transactionsResponse = await get(`/api/v1/loan/transactions/${user.id}`);
      const transactionsData = await transactionsResponse.json();
      if (transactionsData.success) {
        const loans = transactionsData.transactions.filter(t => t.type === 'loan');
        setAllLoans(loans);
      }
      // 刷新资金池信息
      const poolResponse = await get('/api/v1/pool');
      const poolData = await poolResponse.json();
      if (poolData.success) {
        setPoolInfo(poolData.pool);
      }
    } catch (err) {
      console.error('刷新数据失败:', err);
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

      const response = await post('/api/v1/loan/borrow', {
        ...pendingBorrowData,
        challengeId: challengeData.challengeId,
        challengeSignature: challengeSignature
      });

      const data = await response.json();
      if (data.success) {
        setSuccess('借款申请成功！');
        setAmount('');
        setVerificationCode('');
        setShowVerificationDialog(false);
        setPendingBorrowData(null);
        setChallengeData(null);
        setTimeout(() => {
          refreshUserData();
          window.dispatchEvent(new CustomEvent('refreshUserData'));
          window.dispatchEvent(new CustomEvent('refreshPoolData'));
        }, 500);
      } else {
        setError(data.message || '借款失败');
      }
    } catch (err) {
      setError(err.message || '二次签名失败');
    } finally {
      setLoading(false);
    }
  };

  const handleRepay = (transactionId) => {
    const tx = allLoans.find(l => l.id === transactionId);
    if (tx) {
      const total = Number(tx.total_amount) || 0;
      setRepayAmount(total.toFixed(2));
    }
    setRepayTransactionId(transactionId);
    setShowRepayDialog(true);
  };

  const handleConfirmRepay = async () => {
    const selectedTransaction = allLoans.find(l => l.id === repayTransactionId);
    const totalRepayment = selectedTransaction ? Number(selectedTransaction.total_amount) || 0 : 0;
    const repayValue = Number(repayAmount);

    if (isNaN(repayValue) || repayValue <= 0) {
      setError('请输入有效的还款金额');
      return;
    }

    if (repayValue > totalRepayment) {
      setError('还款金额不能超过应还总额');
      return;
    }

    if (!repayVerificationCode) {
      setError('请输入验证口令');
      return;
    }

    if (!creditProof) {
      setError('请先生成信用证明');
      return;
    }

    if (!aesKey) {
      setError('AES密钥不存在，请重新登录');
      return;
    }

    setRepayLoading(true);
    setError('');
    setSuccess('');

    try {
      addCryptoLog({
        operationType: 'SM2签名',
        description: '还款发起',
        status: '待验证',
        detail: `申请还款，交易ID: ${repayTransactionId}`,
        correlationInfo: {
          userId: user.id,
          transactionId: repayTransactionId
        }
      });

      let keyPair = await getSM2KeyPairWithAesKey(aesKey);
      if (!keyPair) {
        const newKeyPair = generateSM2KeyPair();
        await saveSM2KeyPair(newKeyPair, aesKey);
        keyPair = newKeyPair;
      }
      
      const transactionData = {
        userId: user.id.toString(),
        transactionId: repayTransactionId,
        creditProofId: creditProof.id
      };
      
      const signatureData = generateSignatureDataStrict(transactionData, ['creditProofId', 'transactionId', 'userId']);
      const signature = signWithSM2(signatureData, keyPair.privateKey);
      
      keyPair.privateKey = null;
      
      const isPartialRepay = repayValue < totalRepayment;
      
      const response = await post('/api/v1/loan/repay', {
        userId: user.id,
        transactionId: repayTransactionId,
        creditProof: creditProof,
        verificationCode: repayVerificationCode,
        signature,
        ...(isPartialRepay ? { partialAmount: repayValue } : {})
      });

      const data = await response.json();

      if (data.success) {
        // 记录还款成功日志
        addCryptoLog({
          operationType: 'SM2签名',
          description: '还款成功',
          status: '成功',
          detail: '后端用SM2公钥验证签名通过',
          correlationInfo: {
            userId: user.id,
            transactionId: repayTransactionId
          }
        });

        addCryptoLog({
          operationType: 'SM3哈希',
          description: '还款记录哈希',
          status: '成功',
          detail: `生成还款记录SM3哈希: ${data.hash ? data.hash.substring(0, 8) + '...' : '未知'}`,
          correlationInfo: {
            userId: user.id,
            transactionId: repayTransactionId
          }
        });

        setSuccess(data.message || '还款成功！');
        setShowRepayDialog(false);
        setRepayVerificationCode('');
        setRepayAmount('');
        // 刷新用户数据和借款记录
        setTimeout(() => {
          refreshUserData();
          // 通知其他页面刷新数据
          window.dispatchEvent(new CustomEvent('refreshUserData'));
          window.dispatchEvent(new CustomEvent('refreshPoolData'));
        }, 500);
      } else {
        // 记录还款失败日志
        addCryptoLog({
          operationType: 'SM2签名',
          description: '还款失败',
          status: '失败',
          detail: data.message || '还款失败',
          correlationInfo: {
            userId: user.id,
            transactionId: repayTransactionId
          }
        });
        setError(data.message || '还款失败');
      }
    } catch (err) {
      // 记录还款异常日志
      addCryptoLog({
        operationType: 'SM2签名',
        description: '还款异常',
        status: '失败',
        detail: err.message || '网络错误，请稍后重试',
        correlationInfo: {
          userId: user.id,
          transactionId: repayTransactionId
        }
      });
      setError(err.message || '网络错误，请稍后重试');
    } finally {
      setRepayLoading(false);
    }
  };

  if (!user) {
    return (
      <Container maxWidth="md" sx={{ mt: 4 }}>
        <Alert severity="warning">请先登录</Alert>
      </Container>
    );
  }

  return (
    <Container maxWidth="md" sx={{ mt: 4 }}>
      <Grid container spacing={3}>
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h5" gutterBottom>
                借款申请
              </Typography>
              <Typography variant="body1" color="text.secondary">
                请先在"信用证明"页面生成验证口令，然后在下方输入借款金额和验证口令。
              </Typography>
              <Grid container spacing={2} sx={{ mt: 2 }}>
                <Grid item xs={12} sm={6}>
                  <Typography variant="body1" color="primary">
                    当前余额：{(userData?.balance || 0).toFixed(2)} 元
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  {poolInfo && poolInfo.availableAmount !== undefined && (
                    <Typography variant="body1" color="primary">
                      资金池余额：{Number(poolInfo.availableAmount || 0).toFixed(2)} 元
                    </Typography>
                  )}
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="body1" color="primary">
                    信用评分：{Number(userData?.creditScore || creditProof?.creditScore || 0)}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="body1" color="primary">
                    可借额度：{getRemainingLoanLimit(loanConfig, allLoans, userData)}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="body1" color="primary">
                    借款利率：{loanConfig?.loanRate ? `${loanConfig.loanRate}%` : '计算中...'}
                  </Typography>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h5" gutterBottom>
              借款信息
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

            <Box sx={{ mb: 3 }}>
              <TextField
                fullWidth
                label="借款金额"
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={loading}
                sx={{ mb: 2 }}
              />

              <TextField
                select
                fullWidth
                label="借款期限"
                value={term}
                onChange={(e) => setTerm(Number(e.target.value))}
                disabled={loading}
                sx={{ mb: 2 }}
                SelectProps={{
                  native: true
                }}
              >
                <option value={7}>7 天</option>
                <option value={14}>14 天</option>
                <option value={30}>30 天</option>
                <option value={60}>60 天</option>
                <option value={90}>90 天</option>
              </TextField>

              {!creditProof && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  请先在"信用证明"页面生成信用证明
                </Alert>
              )}

              {creditProof && (
                <Alert severity="info" sx={{ mb: 2 }}>
                  当前信用分：{Number(userData?.creditScore || creditProof.creditScore)}，可借额度：{getRemainingLoanLimit(loanConfig, allLoans, userData)}
                </Alert>
              )}

              <Button
                variant="contained"
                color="primary"
                onClick={handleBorrow}
                disabled={loading || !amount || !creditProof}
                fullWidth
              >
                {loading ? <CircularProgress size={24} /> : '申请借款'}
              </Button>
            </Box>

            <Box sx={{ mt: 2 }}>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                提示：
              </Typography>
              <Box component="ul" sx={{ pl: 2, mt: 0 }}>
                <Typography component="li" variant="body2" color="text.secondary">
                  借款前请先在"信用证明"页面生成验证口令
                </Typography>
                <Typography component="li" variant="body2" color="text.secondary">
                  验证口令有效期为24小时
                </Typography>
                <Typography component="li" variant="body2" color="text.secondary">
                  借款期限可选7/14/30/60/90天
                </Typography>
                <Typography component="li" variant="body2" color="text.secondary">
                  按时还款将提高您的信用分
                </Typography>
                <Typography component="li" variant="body2" color="text.secondary">
                  逾期还款将降低您的信用分
                </Typography>
              </Box>
            </Box>
          </Paper>
        </Grid>

        <Grid item xs={12}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h5" gutterBottom>
              借款记录
            </Typography>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>时间</TableCell>
                    <TableCell>金额</TableCell>
                    <TableCell>利息</TableCell>
                    <TableCell>应还总额</TableCell>
                    <TableCell>到期时间</TableCell>
                    <TableCell>状态</TableCell>
                    <TableCell>操作</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {allLoans.map((loan) => (
                    <TableRow key={loan.id}>
                      <TableCell>
                        {loan.timestamp ? new Date(loan.timestamp).toLocaleString() : '未知'}
                      </TableCell>
                      <TableCell>{(Number(loan.amount) || 0).toFixed(2)} 元</TableCell>
                      <TableCell>{(Number(loan.interest) || 0).toFixed(2)} 元</TableCell>
                      <TableCell>{(Number(loan.total_amount) || 0).toFixed(2)} 元</TableCell>
                      <TableCell>
                        {(loan.due_date || loan.dueDate) ? new Date(loan.due_date || loan.dueDate).toLocaleString() : '未知'}
                      </TableCell>
                      <TableCell>
                        <span style={{
                          color: loan.status === 'overdue' ? 'red' : 
                                 loan.status === 'default' ? 'darkred' : 
                                 loan.status === 'completed' ? 'green' : 'black',
                          fontWeight: loan.status === 'overdue' || loan.status === 'default' ? 'bold' : 'normal'
                        }}>
                          {loan.status === 'pending' ? '进行中' : 
                           loan.status === 'completed' ? '已完成' : 
                           loan.status === 'overdue' ? '已逾期' : '已违约'}
                        </span>
                      </TableCell>
                      <TableCell>
                        {loan.status === 'pending' && (
                          <Button
                            variant="contained"
                            color="primary"
                            size="small"
                            onClick={() => handleRepay(loan.id)}
                          >
                            还款
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {allLoans.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} align="center">
                        暂无借款记录
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
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
            onClick={handleConfirmBorrow}
            variant="contained"
            disabled={loading || !verificationCode}
          >
            {loading ? <CircularProgress size={24} /> : '确认借款'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={showRepayDialog} onClose={() => { setShowRepayDialog(false); setRepayVerificationCode(''); setRepayAmount(''); }}>
        <DialogTitle>确认还款</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            您确定要还款吗？
          </Typography>
          <Typography variant="body1" sx={{ mb: 2 }}>
            还款后资金将从您的账户扣除。
          </Typography>
          {!creditProof && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              请先在"信用证明"页面生成信用证明
            </Alert>
          )}
          <TextField
            fullWidth
            label="还款金额"
            type="number"
            value={repayAmount}
            onChange={(e) => setRepayAmount(e.target.value)}
            margin="normal"
            disabled={repayLoading}
            inputProps={{ min: 1, step: 1 }}
            helperText={`应还总额：¥${allLoans.find(l => l.id === repayTransactionId) ? (Number(allLoans.find(l => l.id === repayTransactionId).total_amount) || 0).toFixed(2) : '0.00'}`}
          />
          <TextField
            fullWidth
            label="验证口令"
            value={repayVerificationCode}
            onChange={(e) => setRepayVerificationCode(e.target.value)}
            margin="normal"
            disabled={!creditProof}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setShowRepayDialog(false); setRepayVerificationCode(''); setRepayAmount(''); }}>取消</Button>
          <Button
            onClick={handleConfirmRepay}
            variant="contained"
            disabled={repayLoading || !repayVerificationCode || !creditProof}
          >
            {repayLoading ? <CircularProgress size={24} /> : '确认还款'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={showChallengeDialog} onClose={() => { setShowChallengeDialog(false); setLoading(false); }}>
        <DialogTitle>大额借款二次确认</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            借款金额超过 ¥{loanConfig?.challengeThreshold || 5000}，需要进行二次签名确认。
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

export default Borrow; 