import React from 'react';
import { Paper, Typography, Button, Accordion, AccordionSummary, AccordionDetails, Box } from '@mui/material';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { post } from '../utils/apiUtils';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { 
      hasError: false, 
      error: null, 
      errorInfo: null 
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
    
    this.setState({
      error,
      errorInfo
    });

    const userStr = localStorage.getItem('user');
    const userId = userStr ? JSON.parse(userStr).id : null;

    if (userId) {
      post('/api/v1/crypto-log', {
        userId,
        operationType: '错误边界',
        description: error.message,
        data: { componentStack: errorInfo.componentStack }
      }, true).catch(err => {
        console.warn('Error logging failed, silently degrading:', err);
      });
    }
  }

  handleRefresh = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.href = '/profile';
  };

  render() {
    if (this.state.hasError) {
      return (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh', p: 3 }}>
          <Paper elevation={3} sx={{ p: 4, maxWidth: 500, textAlign: 'center' }}>
            <ErrorOutlineIcon sx={{ fontSize: 64, color: 'warning.main', mb: 2 }} />
            <Typography variant="h5" component="h1" gutterBottom>
              页面加载异常
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
              很抱歉，当前页面遇到了一个错误。请尝试刷新页面或返回首页。
            </Typography>
            <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', mb: 2 }}>
              <Button 
                variant="contained" 
                onClick={this.handleRefresh}
              >
                刷新页面
              </Button>
              <Button 
                variant="outlined" 
                onClick={this.handleGoHome}
              >
                返回首页
              </Button>
            </Box>
            <Accordion sx={{ mt: 2 }}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography variant="body2" color="text.secondary">
                  将以下错误信息发送给管理员以协助排查
                </Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Typography 
                  variant="body2" 
                  component="pre" 
                  sx={{ 
                    textAlign: 'left', 
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    fontFamily: 'monospace',
                    fontSize: '0.75rem',
                    color: 'error.main',
                    bgcolor: 'grey.100',
                    p: 1,
                    borderRadius: 1
                  }}
                >
                  {this.state.error?.message || '未知错误'}
                </Typography>
              </AccordionDetails>
            </Accordion>
          </Paper>
        </Box>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
