import React, { useState, useEffect } from 'react';
import {
  Box, Typography, Card, CardContent, Grid, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Paper, Chip,
  TextField, Button, Alert, CircularProgress, IconButton, Collapse,
  Tooltip, Dialog, DialogTitle, DialogContent, DialogActions
} from '@mui/material';
import {
  Search as SearchIcon,
  VerifiedUser as VerifiedIcon,
  Refresh as RefreshIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon
} from '@mui/icons-material';

const API_BASE = process.env.REACT_APP_API_URL || '';

// 带认证的 fetch 封装
async function authFetch(url, options = {}) {
  const token = localStorage.getItem('token');
  const headers = { ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(url, { ...options, headers });
}

function BlockchainExplorer() {
  const [explorerData, setExplorerData] = useState(null);
  const [chainStatus, setChainStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedRow, setExpandedRow] = useState(null);
  const [verifyId, setVerifyId] = useState('');
  const [verifyResult, setVerifyResult] = useState(null);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [zkpDetail, setZkpDetail] = useState(null);
  const [zkpDetailOpen, setZkpDetailOpen] = useState(false);
  const [zkpDetailLoading, setZkpDetailLoading] = useState(false);

  const handleZkpDetail = async (proofId) => {
    setZkpDetailOpen(true);
    setZkpDetailLoading(true);
    try {
      const res = await authFetch(`/api/v1/blockchain/zkp-verify/${proofId}`);
      const data = await res.json();
      setZkpDetail(data.success ? data : null);
    } catch (e) {
      setZkpDetail(null);
    } finally {
      setZkpDetailLoading(false);
    }
  };

  const fetchExplorer = async () => {
    setLoading(true);
    setError(null);
    try {
      const [explorerRes, statusRes] = await Promise.all([
        authFetch(`${API_BASE}/api/v1/blockchain/explorer?limit=50`),
        authFetch(`${API_BASE}/api/v1/blockchain/status`)
      ]);
      const [explorerData, statusData] = await Promise.all([explorerRes.json(), statusRes.json()]);
      if (explorerData.success) {
        setExplorerData(explorerData.data);
      } else {
        setError(explorerData.message || '查询失败');
      }
      if (statusData.success) {
        setChainStatus(statusData.data);
      }
    } catch (e) {
      setError('无法连接区块链服务: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchExplorer(); }, []);

  const handleVerify = async () => {
    if (!verifyId.trim()) return;
    setVerifyLoading(true);
    setVerifyResult(null);
    try {
      const res = await authFetch(`${API_BASE}/api/v1/blockchain/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hash: verifyId.trim() })
      });
      const data = await res.json();
      setVerifyResult(data);
    } catch (e) {
      setVerifyResult({ success: false, message: e.message });
    } finally {
      setVerifyLoading(false);
    }
  };

  const handleVerifyRecord = async (hashValue) => {
    setVerifyId(hashValue);
    setVerifyLoading(true);
    setVerifyResult(null);
    try {
      const res = await authFetch(`${API_BASE}/api/v1/blockchain/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hash: hashValue })
      });
      const data = await res.json();
      setVerifyResult(data);
    } catch (e) {
      setVerifyResult({ success: false, message: e.message });
    } finally {
      setVerifyLoading(false);
    }
  };

  const formatTime = (ts) => {
    if (!ts) return '-';
    return new Date(ts * 1000).toLocaleString('zh-CN');
  };

  const truncateHash = (hash, len = 20) => {
    if (!hash) return '-';
    return hash.length > len ? hash.slice(0, len) + '...' : hash;
  };

  const typeColor = (type) => {
    const colors = { loan: 'warning', repay: 'success', register: 'info', zkp: 'secondary' };
    return colors[type] || 'default';
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
        <CircularProgress />
        <Typography sx={{ ml: 2 }}>加载区块链数据...</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto', p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" fontWeight={700}>区块链浏览器</Typography>
        <IconButton onClick={fetchExplorer} disabled={loading}>
          <RefreshIcon />
        </IconButton>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {explorerData && (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={12} sm={4}>
            <Card>
              <CardContent>
                <Typography color="text.secondary" gutterBottom>链上总记录</Typography>
                <Typography variant="h3" fontWeight={700}>{explorerData.totalRecords}</Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={4}>
            <Card>
              <CardContent>
                <Typography color="text.secondary" gutterBottom>类型分布</Typography>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
                  {Object.entries(explorerData.typeStats || {}).map(([type, count]) => (
                    <Chip key={type} label={`${type}: ${count}`} color={typeColor(type)} size="small" />
                  ))}
                </Box>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={4}>
            <Card>
              <CardContent>
                <Typography color="text.secondary" gutterBottom>最近记录数</Typography>
                <Typography variant="h3" fontWeight={700}>{explorerData.recentRecords?.length || 0}</Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {chainStatus && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>区块链基础设施状态</Typography>
            <Grid container spacing={2}>
              <Grid item xs={6} sm={3}>
                <Typography color="text.secondary" variant="body2">网络</Typography>
                <Typography fontWeight={600}>{chainStatus.networkName || chainStatus.network || '-'}</Typography>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Typography color="text.secondary" variant="body2">连接状态</Typography>
                <Chip size="small" label={chainStatus.isConnected ? '已连接' : '未连接'} color={chainStatus.isConnected ? 'success' : 'error'} />
              </Grid>
              <Grid item xs={6} sm={3}>
                <Typography color="text.secondary" variant="body2">总存证记录</Typography>
                <Typography fontWeight={600}>{chainStatus.totalRecords ?? '-'}</Typography>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Typography color="text.secondary" variant="body2">合约数量</Typography>
                <Typography fontWeight={600}>{chainStatus.contracts ? Object.keys(chainStatus.contracts).length : '-'}</Typography>
              </Grid>
            </Grid>
          </CardContent>
        </Card>
      )}

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>链上存证验证</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            输入 SM3 哈希值，验证该存证是否存在于区块链上
          </Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField
              size="small"
              fullWidth
              placeholder="输入 SM3 哈希值（如 0xabc...）"
              value={verifyId}
              onChange={(e) => setVerifyId(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
            />
            <Button variant="contained" onClick={handleVerify} disabled={verifyLoading} startIcon={<SearchIcon />}>
              验证
            </Button>
          </Box>
          {verifyResult && (
            <Alert severity={verifyResult.data?.verified ? 'success' : 'error'} sx={{ mt: 2 }}>
              {verifyResult.data?.verified
                ? `✅ 存证验证通过 — 链上记录存在，操作类型: ${verifyResult.data.operationType}，用户: ${verifyResult.data.userId}`
                : '❌ 验证失败 — ' + (verifyResult.data?.reason || verifyResult.message || '未知原因')}
            </Alert>
          )}
        </CardContent>
      </Card>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>索引</TableCell>
              <TableCell>时间</TableCell>
              <TableCell>操作类型</TableCell>
              <TableCell>用户ID</TableCell>
              <TableCell>SM3 哈希</TableCell>
              <TableCell>状态</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {(explorerData?.recentRecords || []).slice().reverse().map((record) => (
              <React.Fragment key={record.index}>
                <TableRow hover>
                  <TableCell>{record.index}</TableCell>
                  <TableCell>{formatTime(record.timestamp)}</TableCell>
                  <TableCell>
                    <Chip label={record.operationType} color={typeColor(record.operationType)} size="small" />
                  </TableCell>
                  <TableCell>{record.userId || '-'}</TableCell>
                  <TableCell>
                    <Tooltip title={record.hashValue}>
                      <Typography variant="body2" fontFamily="monospace">
                        {truncateHash(record.hashValue)}
                      </Typography>
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    <Chip icon={<VerifiedIcon />} label="已上链" color="success" size="small" variant="outlined" />
                  </TableCell>
                  <TableCell>
                    <IconButton size="small" onClick={() => setExpandedRow(expandedRow === record.index ? null : record.index)}>
                      {expandedRow === record.index ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                    </IconButton>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ py: 0 }} colSpan={7}>
                    <Collapse in={expandedRow === record.index}>
                      <Box sx={{ py: 2, bgcolor: 'grey.50', px: 2, borderRadius: 1, mb: 1 }}>
                        <Typography variant="body2" fontFamily="monospace" gutterBottom>
                          <strong>完整哈希:</strong> {record.hashValue}
                        </Typography>
                        <Typography variant="body2">
                          <strong>提交者:</strong> {record.submitter}
                        </Typography>
                        <Typography variant="body2">
                          <strong>上链时间:</strong> {formatTime(record.timestamp)}
                        </Typography>
                        {record.operationType === 'zkp' && (
                          <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                            {record.chainVerified ? (
                              <Chip
                                size="small"
                                label={record.chainValid ? '链上验证通过' : '链上验证失败'}
                                color={record.chainValid ? 'success' : 'error'}
                                variant="outlined"
                              />
                            ) : (
                              <Chip size="small" label="待验证" color="default" variant="outlined" />
                            )}
                            {record.proofId && (
                              <Button size="small" onClick={() => handleZkpDetail(record.proofId)}>
                                查看详情
                              </Button>
                            )}
                          </Box>
                        )}
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<VerifiedIcon />}
                          sx={{ mt: 1 }}
                          onClick={() => handleVerifyRecord(record.hashValue)}
                          disabled={verifyLoading}
                        >
                          验证此存证
                        </Button>
                      </Box>
                    </Collapse>
                  </TableCell>
                </TableRow>
              </React.Fragment>
            ))}
            {(!explorerData?.recentRecords || explorerData.recentRecords.length === 0) && (
              <TableRow>
                <TableCell colSpan={7} align="center">
                  <Typography color="text.secondary" sx={{ py: 4 }}>暂无链上记录</Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={zkpDetailOpen} onClose={() => setZkpDetailOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>ZKP 链上验证详情</DialogTitle>
        <DialogContent>
          {zkpDetailLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          ) : zkpDetail ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 1 }}>
              <Typography variant="body2"><strong>Proof ID:</strong> {zkpDetail.proofId || '-'}</Typography>
              <Typography variant="body2"><strong>Proof Hash:</strong> {zkpDetail.proofHash || '-'}</Typography>
              <Typography variant="body2"><strong>链下验证:</strong> {zkpDetail.isValid ? '有效' : '无效'}</Typography>
              <Typography variant="body2"><strong>链上验证:</strong> {zkpDetail.chainVerified ? (zkpDetail.chainValid ? '通过' : '失败') : '待验证'}</Typography>
              <Typography variant="body2"><strong>提交者:</strong> {zkpDetail.submitter || '-'}</Typography>
              <Typography variant="body2"><strong>上链时间:</strong> {zkpDetail.timestamp ? new Date(zkpDetail.timestamp * 1000).toLocaleString() : '-'}</Typography>
            </Box>
          ) : (
            <Typography color="text.secondary" sx={{ py: 2 }}>无验证数据</Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setZkpDetailOpen(false)}>关闭</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default BlockchainExplorer;
