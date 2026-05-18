import React, { useState, useEffect } from 'react';
import {
  Box, Typography, Card, CardContent, Grid, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Paper, Chip,
  TextField, Button, Alert, CircularProgress, IconButton, Collapse,
  Tooltip
} from '@mui/material';
import {
  Search as SearchIcon,
  VerifiedUser as VerifiedIcon,
  Refresh as RefreshIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon
} from '@mui/icons-material';

const API_BASE = process.env.REACT_APP_API_URL || '';

function BlockchainExplorer() {
  const [explorerData, setExplorerData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedRow, setExpandedRow] = useState(null);
  const [verifyId, setVerifyId] = useState('');
  const [verifyResult, setVerifyResult] = useState(null);
  const [verifyLoading, setVerifyLoading] = useState(false);

  const fetchExplorer = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/blockchain/explorer?limit=50`);
      const data = await res.json();
      if (data.success) {
        setExplorerData(data.data);
      } else {
        setError(data.message || '查询失败');
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
      const res = await fetch(`${API_BASE}/api/v1/blockchain/verify/${encodeURIComponent(verifyId)}`);
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

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>验证交易</Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField
              size="small"
              fullWidth
              placeholder="输入交易ID"
              value={verifyId}
              onChange={(e) => setVerifyId(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
            />
            <Button variant="contained" onClick={handleVerify} disabled={verifyLoading} startIcon={<SearchIcon />}>
              验证
            </Button>
          </Box>
          {verifyResult && (
            <Alert severity={verifyResult.data?.isValid ? 'success' : 'error'} sx={{ mt: 2 }}>
              {verifyResult.data?.isValid
                ? '✅ 交易验证通过 — 链上记录与本地数据一致'
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
    </Box>
  );
}

export default BlockchainExplorer;
