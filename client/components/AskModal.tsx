import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { FontAwesome6 } from '@expo/vector-icons';
import EventSource from 'react-native-sse';
import { getAuthHeaders } from '@/utils/api';

const EXPO_PUBLIC_BACKEND_BASE_URL = process.env.EXPO_PUBLIC_BACKEND_BASE_URL;

interface AskModalProps {
  question: string;
  onClose: () => void;
}

// 由父组件条件渲染（每次提问重新挂载，状态自然重置）
export default function AskModal({ question, onClose }: AskModalProps) {
  const [answer, setAnswer] = useState('');
  const [status, setStatus] = useState<'streaming' | 'done' | 'error'>('streaming');
  const sseRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!question.trim()) return;

    let cancelled = false;

    const connect = async () => {
      /**
       * 服务端文件：server/src/routes/items.ts
       * 接口：POST /api/v1/items/ask（SSE 流式输出）
       * Body 参数：question: string
       * Header：x-session（登录态 token）
       * 事件格式：data: {"delta": "..."}，结束标志 data: [DONE]
       */
      const authHeaders = await getAuthHeaders();
      if (cancelled) return;
      const sse = new EventSource(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/items/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ question: question.trim() }),
      });
      sseRef.current = sse;

      sse.addEventListener('message', (event) => {
      if (!event.data) return;
      if (event.data === '[DONE]') {
        setStatus('done');
        sse.close();
        return;
      }
        try {
          const parsed = JSON.parse(event.data);
          if (parsed.error) {
            setAnswer(parsed.error);
            setStatus('error');
            sse.close();
            return;
          }
          if (parsed.delta) {
            setAnswer((prev) => prev + parsed.delta);
          }
        } catch {
          // 忽略非 JSON 片段
        }
      });

      sse.addEventListener('error', () => {
        setStatus((prev) => (prev === 'streaming' ? 'error' : prev));
        setAnswer((prev) => prev || '连接失败，请检查网络后重试');
        sse.close();
      });
    };

    connect();

    return () => {
      cancelled = true;
      sseRef.current?.close();
      sseRef.current = null;
    };
  }, [question]);

  const handleClose = () => {
    sseRef.current?.close();
    sseRef.current = null;
    onClose();
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.aiBadge}>
                <FontAwesome6 name="wand-magic-sparkles" size={13} color="#FFF" />
              </View>
              <Text style={styles.headerTitle}>AI 物品问答</Text>
            </View>
            <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
              <FontAwesome6 name="xmark" size={16} color="#636E72" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            {/* 问题气泡 */}
            <View style={styles.questionRow}>
              <View style={styles.questionBubble}>
                <Text style={styles.questionText}>{question}</Text>
              </View>
            </View>

            {/* 回答区 */}
            <View style={styles.answerCard}>
              {status === 'streaming' && answer === '' ? (
                <View style={styles.thinkingRow}>
                  <ActivityIndicator size="small" color="#6C63FF" />
                  <Text style={styles.thinkingText}>正在翻找你的物品记录…</Text>
                </View>
              ) : (
                <>
                  <Text style={[styles.answerText, status === 'error' && styles.errorText]}>
                    {answer}
                    {status === 'streaming' ? '▍' : ''}
                  </Text>
                  {status === 'done' && (
                    <Text style={styles.disclaimer}>答案仅基于你的物品记录生成</Text>
                  )}
                </>
              )}
            </View>
          </ScrollView>

          {/* Footer */}
          <TouchableOpacity style={styles.doneBtn} onPress={handleClose}>
            <Text style={styles.doneBtnText}>知道了</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: '#F0F0F3',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    maxHeight: '80%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  aiBadge: {
    width: 28,
    height: 28,
    borderRadius: 10,
    backgroundColor: '#6C63FF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2D3436',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#E8E8EB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  body: {
    flexGrow: 0,
    marginBottom: 16,
  },
  questionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 14,
  },
  questionBubble: {
    backgroundColor: '#6C63FF',
    borderRadius: 18,
    borderBottomRightRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 10,
    maxWidth: '85%',
  },
  questionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFF',
  },
  answerCard: {
    backgroundColor: '#FFF',
    borderRadius: 18,
    borderTopLeftRadius: 4,
    padding: 16,
    minHeight: 90,
  },
  thinkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  thinkingText: {
    fontSize: 13,
    color: '#636E72',
  },
  answerText: {
    fontSize: 15,
    lineHeight: 24,
    color: '#2D3436',
  },
  errorText: {
    color: '#FF6B6B',
  },
  disclaimer: {
    marginTop: 12,
    fontSize: 11,
    color: '#B2BEC3',
  },
  doneBtn: {
    backgroundColor: '#6C63FF',
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    shadowColor: '#6C63FF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 4,
  },
  doneBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFF',
  },
});
