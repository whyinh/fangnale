import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  TouchableWithoutFeedback,
  TextInput,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useAudioRecorder, useAudioRecorderState, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, createAudioPlayer } from 'expo-audio';
import type { AudioPlayer } from 'expo-audio';
import { Feather } from '@expo/vector-icons';
import EventSource from 'react-native-sse';
import { createFormDataFile } from '@/utils';

const BASE = process.env.EXPO_PUBLIC_BACKEND_BASE_URL;

type Mode = 'note' | 'ask';
type Phase = 'idle' | 'recording' | 'processing' | 'result';

interface Category {
  id: number;
  name: string;
  color: string;
}

interface VoicePanelProps {
  visible: boolean;
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}

// Web 端 MediaRecorder 默认输出 audio/webm，后端 ASR 不支持；
// 按浏览器能力选择 audio/mp4（Chrome/Safari）或 audio/ogg（Firefox），均兼容 ASR。
function buildWebRecordingOptions() {
  const preset = RecordingPresets.HIGH_QUALITY as any;
  if (Platform.OS !== 'web' || typeof (globalThis as any).MediaRecorder === 'undefined') {
    return preset;
  }
  const MediaRecorderCtor = (globalThis as any).MediaRecorder;
  const candidates = ['audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/webm'];
  const mimeType = candidates.find((m) => {
    try {
      return MediaRecorderCtor.isTypeSupported(m);
    } catch {
      return false;
    }
  });
  return {
    ...preset,
    web: { ...(preset.web || {}), ...(mimeType ? { mimeType } : {}) },
  };
}

const webRecordingOptions = buildWebRecordingOptions();

export default function VoicePanel({ visible, categories, onClose, onSaved }: VoicePanelProps) {
  const [mode, setMode] = useState<Mode>('note');
  const [phase, setPhase] = useState<Phase>('idle');
  const [transcript, setTranscript] = useState('');
  const [errorText, setErrorText] = useState('');

  // 语音速记结果（可编辑）
  const [draftName, setDraftName] = useState('');
  const [draftLocation, setDraftLocation] = useState('');
  const [draftCategory, setDraftCategory] = useState<number | null>(null);
  const [draftTags, setDraftTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // 语音查找结果
  const [askAnswer, setAskAnswer] = useState('');
  const [askStreaming, setAskStreaming] = useState(false);
  const [playing, setPlaying] = useState(false);

  const recorder = useAudioRecorder(webRecordingOptions);
  const playerRef = useRef<AudioPlayer | null>(null);
  const sseRef = useRef<EventSource | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // 录音中脉冲动画
  useEffect(() => {
    if (phase !== 'recording') {
      pulseAnim.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [phase, pulseAnim]);

  const cleanup = useCallback(() => {
    if (recordTimerRef.current) {
      clearTimeout(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }
    if (playerRef.current) {
      playerRef.current.remove();
      playerRef.current = null;
    }
    if (recorder.isRecording) {
      recorder.stop().catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (!visible) cleanup();
    return cleanup;
  }, [visible, cleanup]);

  const resetAll = useCallback(() => {
    cleanup();
    setPhase('idle');
    setTranscript('');
    setErrorText('');
    setDraftName('');
    setDraftLocation('');
    setDraftCategory(null);
    setDraftTags([]);
    setAskAnswer('');
    setAskStreaming(false);
    setPlaying(false);
  }, [cleanup]);

  const handleClose = () => {
    resetAll();
    onClose();
  };

  // ============ 录音控制（点击开始/再点停止） ============
  const startRecording = async () => {
    try {
      setErrorText('');
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) {
        Alert.alert('需要麦克风权限', '请在系统设置中允许 App 使用麦克风');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      recorder.record();
      setPhase('recording');
      // 最长 60 秒自动停止
      recordTimerRef.current = setTimeout(() => {
        stopRecording();
      }, 60000);
    } catch (e) {
      console.error('startRecording failed:', e);
      Alert.alert('录音失败', '无法启动录音，请重试');
    }
  };

  const stopRecording = async () => {
    if (recordTimerRef.current) {
      clearTimeout(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    setPhase('processing');
    try {
      await recorder.stop();
      const uri = recorder.uri;
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
      if (uri) {
        await processAudio(uri);
      } else {
        setPhase('idle');
        setErrorText('录音无效，请重试');
      }
    } catch (e) {
      console.error('stopRecording failed:', e);
      setPhase('idle');
      setErrorText('录音处理失败，请重试');
    }
  };

  const handleMicPress = () => {
    if (phase === 'recording') {
      stopRecording();
    } else if (phase === 'idle' || phase === 'result') {
      startRecording();
    }
  };

  // ============ 音频处理 ============
  const processAudio = async (uri: string) => {
    if (mode === 'note') {
      await processVoiceNote(uri);
    } else {
      await processVoiceAsk(uri);
    }
  };

  const processVoiceNote = async (uri: string) => {
    try {
      /**
       * 服务端文件：server/src/routes/speech.ts
       * 接口：POST /api/v1/speech/voice-note
       * Body 参数（FormData）：audio: 音频文件
       * 返回：{ transcript: string, name: string, location: string, category_id: number | null, tags: string[] }
       */
      const formData = new FormData();
      formData.append('audio', createFormDataFile(uri, `voice_${Date.now()}.m4a`, 'audio/m4a') as any);
      const res = await fetch(`${BASE}/api/v1/speech/voice-note`, { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '识别失败');
      setTranscript(data.transcript || '');
      setDraftName(data.name || '');
      setDraftLocation(data.location || '');
      setDraftCategory(data.category_id ?? categories[0]?.id ?? null);
      setDraftTags(Array.isArray(data.tags) ? data.tags : []);
      setPhase('result');
    } catch (e) {
      setPhase('idle');
      setErrorText(e instanceof Error ? e.message : '识别失败，请重试');
    }
  };

  const processVoiceAsk = async (uri: string) => {
    try {
      /**
       * 服务端文件：server/src/routes/speech.ts
       * 接口：POST /api/v1/speech/transcribe
       * Body 参数（FormData）：audio: 音频文件
       * 返回：{ transcript: string }
       */
      const formData = new FormData();
      formData.append('audio', createFormDataFile(uri, `voice_${Date.now()}.m4a`, 'audio/m4a') as any);
      const res = await fetch(`${BASE}/api/v1/speech/transcribe`, { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '识别失败');
      const question = (data.transcript || '').trim();
      if (!question) {
        setPhase('idle');
        setErrorText('没听清，请再说一次');
        return;
      }
      setTranscript(question);
      setPhase('result');
      streamAskAnswer(question);
    } catch (e) {
      setPhase('idle');
      setErrorText(e instanceof Error ? e.message : '识别失败，请重试');
    }
  };

  // ============ 问位置：SSE 流式回答 + TTS 播报 ============
  const streamAskAnswer = (question: string) => {
    setAskAnswer('');
    setAskStreaming(true);
    let fullAnswer = '';
    /**
     * 服务端文件：server/src/routes/items.ts
     * 接口：POST /api/v1/items/ask（SSE 流式）
     * Body 参数：question: string
     */
    const sse = new EventSource(`${BASE}/api/v1/items/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });
    sseRef.current = sse;

    sse.addEventListener('message', (event) => {
      if (!event.data) return;
      if (event.data === '[DONE]') {
        setAskStreaming(false);
        sse.close();
        sseRef.current = null;
        if (fullAnswer) playTts(fullAnswer);
        return;
      }
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.error) {
          setAskAnswer(parsed.error);
          setAskStreaming(false);
          sse.close();
          sseRef.current = null;
          return;
        }
        if (parsed.delta) {
          fullAnswer += parsed.delta;
          setAskAnswer((prev) => prev + parsed.delta);
        }
      } catch {
        // 忽略不完整的数据块
      }
    });

    sse.addEventListener('error', () => {
      setAskStreaming(false);
      if (!fullAnswer) setAskAnswer('连接失败，请检查网络后重试');
      sse.close();
      sseRef.current = null;
    });
  };

  const playTts = async (text: string) => {
    try {
      if (playerRef.current) {
        playerRef.current.remove();
        playerRef.current = null;
      }
      setPlaying(true);
      /**
       * 服务端文件：server/src/routes/speech.ts
       * 接口：POST /api/v1/speech/tts
       * Body 参数：text: string
       * 返回：{ audio_url: string }
       */
      const res = await fetch(`${BASE}/api/v1/speech/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok || !data.audio_url) throw new Error('语音合成失败');
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      const player = createAudioPlayer({ uri: data.audio_url });
      playerRef.current = player;
      player.addListener('playbackStatusUpdate', (status: any) => {
        if (status.didJustFinish) {
          setPlaying(false);
          player.remove();
          if (playerRef.current === player) playerRef.current = null;
        }
      });
      player.play();
    } catch (e) {
      console.error('playTts failed:', e);
      setPlaying(false);
    }
  };

  const stopTts = () => {
    if (playerRef.current) {
      playerRef.current.remove();
      playerRef.current = null;
    }
    setPlaying(false);
  };

  // ============ 语音速记：保存物品 ============
  const handleSaveNote = async () => {
    if (!draftName.trim()) {
      Alert.alert('提示', '请填写物品名称');
      return;
    }
    if (!draftLocation.trim()) {
      Alert.alert('提示', '请填写存放位置');
      return;
    }
    setSaving(true);
    try {
      /**
       * 服务端文件：server/src/routes/items.ts
       * 接口：POST /api/v1/items
       * Body 参数：name: string, location: string, category_id: number, tags?: string
       */
      const res = await fetch(`${BASE}/api/v1/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draftName.trim(),
          location: draftLocation.trim(),
          category_id: draftCategory,
          tags: draftTags.join(','),
        }),
      });
      if (!res.ok) throw new Error('保存失败');
      handleClose();
      onSaved();
    } catch (e) {
      Alert.alert('保存失败', e instanceof Error ? e.message : '请重试');
    } finally {
      setSaving(false);
    }
  };

  const micColor = phase === 'recording' ? '#FF6584' : '#6C63FF';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <TouchableWithoutFeedback onPress={handleClose}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
              <View style={styles.panel}>
                {/* 模式切换 + 关闭 */}
                <View style={styles.header}>
                  <View style={styles.modeTabs}>
                    <TouchableOpacity
                      style={[styles.modeTab, mode === 'note' && styles.modeTabActive]}
                      onPress={() => { resetAll(); setMode('note'); }}
                    >
                      <Feather name="package" size={14} color={mode === 'note' ? '#FFF' : '#8B84A8'} />
                      <Text style={[styles.modeTabText, mode === 'note' && styles.modeTabTextActive]}>记物品</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.modeTab, mode === 'ask' && styles.modeTabActive]}
                      onPress={() => { resetAll(); setMode('ask'); }}
                    >
                      <Feather name="search" size={14} color={mode === 'ask' ? '#FFF' : '#8B84A8'} />
                      <Text style={[styles.modeTabText, mode === 'ask' && styles.modeTabTextActive]}>问位置</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
                    <Feather name="x" size={20} color="#9A93B8" />
                  </TouchableOpacity>
                </View>

                <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
                  {/* 提示语 */}
                  <Text style={styles.hint}>
                    {phase === 'idle' && (mode === 'note' ? '点一下，说出物品和位置，如：\n"护照放书房抽屉第二层了"' : '点一下，问你想找的东西，如：\n"我的护照在哪"')}
                    {phase === 'recording' && '正在聆听… 说完再点一下'}
                    {phase === 'processing' && '正在识别…'}
                    {phase === 'result' && (mode === 'note' ? '确认一下，改完直接保存' : '')}
                  </Text>

                  {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}

                  {/* 麦克风按钮 */}
                  <View style={styles.micWrap}>
                    <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                      <TouchableOpacity
                        style={[styles.micButton, { backgroundColor: micColor }, phase === 'processing' && { opacity: 0.5 }]}
                        onPress={handleMicPress}
                        disabled={phase === 'processing'}
                        activeOpacity={0.85}
                      >
                        {phase === 'processing' ? (
                          <ActivityIndicator color="#FFF" size="large" />
                        ) : (
                          <Feather name={phase === 'recording' ? 'square' : 'mic'} size={34} color="#FFF" />
                        )}
                      </TouchableOpacity>
                    </Animated.View>
                  </View>

                  {/* 结果区 */}
                  {phase === 'result' && transcript ? (
                    <View style={styles.transcriptCard}>
                      <Feather name="message-circle" size={14} color="#8B84A8" />
                      <Text style={styles.transcriptText}>「{transcript}」</Text>
                    </View>
                  ) : null}

                  {/* 记物品结果：可编辑草稿 */}
                  {phase === 'result' && mode === 'note' ? (
                    <View style={styles.draftCard}>
                      <View style={styles.draftRow}>
                        <Text style={styles.draftLabel}>物品</Text>
                        <TextInput
                          style={styles.draftInput}
                          value={draftName}
                          onChangeText={setDraftName}
                          placeholder="物品名称"
                          placeholderTextColor="#B0AACB"
                        />
                      </View>
                      <View style={styles.draftRow}>
                        <Text style={styles.draftLabel}>位置</Text>
                        <TextInput
                          style={styles.draftInput}
                          value={draftLocation}
                          onChangeText={setDraftLocation}
                          placeholder="存放位置"
                          placeholderTextColor="#B0AACB"
                        />
                      </View>
                      <View style={styles.draftRow}>
                        <Text style={styles.draftLabel}>分类</Text>
                        <View style={{ flex: 1 }}>
                          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.draftCats}>
                          {categories.map((cat) => (
                            <TouchableOpacity
                              key={cat.id}
                              style={[
                                styles.draftCatChip,
                                draftCategory === cat.id && { backgroundColor: cat.color, borderColor: cat.color },
                              ]}
                              onPress={() => setDraftCategory(cat.id)}
                            >
                              <Text style={[styles.draftCatChipText, draftCategory === cat.id && { color: '#FFF' }]}>
                                {cat.name}
                              </Text>
                            </TouchableOpacity>
                          ))}
                          </ScrollView>
                        </View>
                      </View>
                      {draftTags.length > 0 ? (
                        <View style={styles.draftTagsRow}>
                          {draftTags.map((tag, i) => (
                            <View key={i} style={styles.draftTag}>
                              <Text style={styles.draftTagText}>{tag}</Text>
                            </View>
                          ))}
                        </View>
                      ) : null}
                      <TouchableOpacity
                        style={[styles.saveButton, saving && { opacity: 0.6 }]}
                        onPress={handleSaveNote}
                        disabled={saving}
                      >
                        {saving ? (
                          <ActivityIndicator color="#FFF" size="small" />
                        ) : (
                          <>
                            <Feather name="check" size={18} color="#FFF" />
                            <Text style={styles.saveButtonText}>保存这条记录</Text>
                          </>
                        )}
                      </TouchableOpacity>
                    </View>
                  ) : null}

                  {/* 问位置结果：流式回答 + 播报 */}
                  {phase === 'result' && mode === 'ask' ? (
                    <View style={styles.answerCard}>
                      <View style={styles.answerHeader}>
                        <Text style={styles.answerTitle}>回答</Text>
                        {askAnswer && !askStreaming ? (
                          <TouchableOpacity onPress={playing ? stopTts : () => playTts(askAnswer)} style={styles.replayButton}>
                            <Feather name={playing ? 'stop-circle' : 'volume-2'} size={16} color="#6C63FF" />
                            <Text style={styles.replayText}>{playing ? '停止' : '重播'}</Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                      <Text style={styles.answerText}>
                        {askAnswer}
                        {askStreaming ? <Text style={styles.cursor}>▍</Text> : null}
                      </Text>
                      {playing ? <Text style={styles.playingHint}>正在播报…</Text> : null}
                    </View>
                  ) : null}
                </ScrollView>
              </View>
            </KeyboardAvoidingView>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(30, 25, 60, 0.4)',
    justifyContent: 'flex-end',
  },
  panel: {
    backgroundColor: '#F0F0F3',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingTop: 18,
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    maxHeight: '85%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  modeTabs: {
    flexDirection: 'row',
    backgroundColor: '#E8E8ED',
    borderRadius: 12,
    padding: 3,
    gap: 3,
  },
  modeTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
  },
  modeTabActive: {
    backgroundColor: '#6C63FF',
  },
  modeTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8B84A8',
  },
  modeTabTextActive: {
    color: '#FFF',
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#FFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flexGrow: 0,
  },
  hint: {
    fontSize: 14,
    color: '#8B84A8',
    textAlign: 'center',
    lineHeight: 22,
    marginTop: 6,
  },
  errorText: {
    fontSize: 13,
    color: '#E17055',
    textAlign: 'center',
    marginTop: 8,
  },
  micWrap: {
    alignItems: 'center',
    marginVertical: 22,
  },
  micButton: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#6C63FF',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  transcriptCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#E8E8ED',
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
  },
  transcriptText: {
    flex: 1,
    fontSize: 14,
    color: '#4A4560',
    lineHeight: 20,
  },
  draftCard: {
    backgroundColor: '#FFF',
    borderRadius: 22,
    padding: 18,
    gap: 14,
    shadowColor: '#6C63FF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  draftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  draftLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#8B84A8',
    width: 32,
  },
  draftInput: {
    flex: 1,
    backgroundColor: '#F4F4F8',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: '#3A3555',
  },
  draftCats: {
    gap: 8,
    paddingRight: 8,
  },
  draftCatChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: '#F4F4F8',
    borderWidth: 1,
    borderColor: '#ECECF2',
  },
  draftCatChipText: {
    fontSize: 13,
    color: '#6A6488',
    fontWeight: '500',
  },
  draftTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  draftTag: {
    backgroundColor: 'rgba(108, 99, 255, 0.1)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  draftTagText: {
    fontSize: 12,
    color: '#6C63FF',
    fontWeight: '500',
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#6C63FF',
    borderRadius: 16,
    paddingVertical: 14,
    shadowColor: '#6C63FF',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 5,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFF',
  },
  answerCard: {
    backgroundColor: '#FFF',
    borderRadius: 22,
    padding: 18,
    shadowColor: '#6C63FF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  answerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  answerTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#9A93B8',
  },
  replayButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  replayText: {
    fontSize: 13,
    color: '#6C63FF',
    fontWeight: '600',
  },
  answerText: {
    fontSize: 16,
    color: '#3A3555',
    lineHeight: 26,
  },
  cursor: {
    color: '#6C63FF',
  },
  playingHint: {
    marginTop: 10,
    fontSize: 12,
    color: '#6C63FF',
  },
});
