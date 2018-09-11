/**
 * @files 基础 ST 组件,内容脚本和弹出页都会用到
 */

import '../fontello/css/selection-translator.css';
import './style.scss';
import Vue from 'vue';
import widgetMixin from './vue-st';
import chromeCall from 'chrome-call';

import locales from '../locales';
import template from './template.html';
// const request = require('superagent');

// 去掉 locales 里的 *-* 类语种，除了 zh-CN、zh-TW 和 zh-HK（百度翻译里的粤语）
const translateLocales = [];

locales.forEach( locale => {
  const {localeId} = locale;

  if ( !localeId.includes( '-' ) || ( localeId === 'zh-CN' || localeId == 'zh-TW' || localeId == 'zh-HK' ) ) {
    translateLocales.push( locale );
  }
} );

const resolvedEmptyPromise = Promise.resolve() ,
  noop = ()=> {};

/**
 * 翻译窗口的基础 Vue 构造函数。
 * 注意：这个构造函数需要一个额外的 options：client
 */
export default Vue.extend( {
  template ,
  data : ()=>({
    locales : translateLocales ,
    showForm : false ,
    review : '' ,
    reviewDict: [] ,
    showdict: false ,
    query : {
      text : '' ,
      from : '' ,
      to : '' ,
      api : ''
    } ,
    result : {
      error : '' ,
      phonetic : '' ,
      dict : [] ,
      result : [] ,
      link : ''
    }
  }) ,
  created() {
    this.$options.client.once( 'disconnect' , ()=> {
      this.result = {
        error : '连接到翻译引擎时发生了错误，请刷新网页或重启浏览器后再试。'
      }
    } );
    this.loadReview();
  } ,
  computed : {
    apiName() {
      return {
        YouDao: '有道翻译',
        Google: '谷歌翻译',
        GoogleCN: '谷歌翻译（国内）',
        BaiDu: '百度翻译'
      }[this.query.api] || ''
    }
  },
  methods : {

    /**
     * 翻译快捷键：Ctrl + Enter
     * @param event
     */
    ctrlEnter( event ) {
      if ( event.ctrlKey ) {
        this.safeTranslate();
      }
    } ,

    /**
     * 仅当有文本时才翻译
     */
    safeTranslate() {
      if ( this.query.text.trim() ) {
        this.translate();
      }
    } ,

    /**
     * 从后台网页获取查询结果
     * @returns {Promise}
     */
    getResult() {
      if ( this.$options.client.disconnected ) {
        return resolvedEmptyPromise;
      }
      return this.$options.client
        .send( 'get translate result' , this.query , true )
        .then( resultObj => {
          if (resultObj.code) {
            let errMsg = {
              NETWORK_ERROR: '网络错误，请检查你的网络设置。',
              API_SERVER_ERROR: '接口返回了错误的数据，请稍候重试。',
              UNSUPPORTED_LANG: '不支持的语种，请使用谷歌翻译重试。'
            }[resultObj.code]
            if (resultObj.error) {
              errMsg += resultObj.error
            }
            this.result = {error: errMsg}
          } else {
          const {phonetic} = resultObj;
          /* istanbul ignore if */
          if ( phonetic ) {
            resultObj.phonetic = '/' + phonetic[0].value + '/';
          }
          this.result = resultObj;
        }
        } , noop );
      // 只有在一种特殊情况下才会走进 catch 分支:
      // 消息发送出去后但还没得到响应时就被后台断开了连接.
      // 不过出现这种情况的可能性极低.
    } ,

    /**
     * 交换源语种与目标语种
     */
    exchangeLocale() {
      const {to,from} = this.query;
      this.query.to = from;
      this.query.from = to;
    } ,

    /**
     * 打开设置页
     */
    openOptions() {
      this.$options.client.send( 'open options' );
    } ,

    /**
     * 复制文本
     * @param {String|String[]} textOrTextArray
     * @param {MouseEvent} event
     */
    copy( textOrTextArray , event ) {
      if ( Array.isArray( textOrTextArray ) ) {
        textOrTextArray = textOrTextArray.join( '\n' );
      }
      this.$options.client.send( 'copy' , textOrTextArray );

      const {target} = event ,
        original = target.textContent;
      target.textContent = '已复制';
      setTimeout( ()=> target.textContent = original , 2000 );
    } ,

    /**
     * 把 String 对象变成 Map 对象
     * @param {String} str
     * @return {Map} result map object
     */
    getMapFromString(str) {
      return new Map(JSON.parse(typeof str === 'string' ? str : '[]'));
    },

    /**
     * 添加背诵单词
     * @param {String} text
     * @param {String[]} dict
     * @param {MouseEvent} event
     */
    addWord(text, dict, event) {
      const end = (msg) => {
        event.target.textContent = msg;
        setTimeout(() => {
          event.target.textContent = '背诵';
        }, 2000);
      }
      const fail = () => end('出现了异常！');
      chromeCall('storage.local.get', ['dictionaries'])
        .then((result) => {
          const res = this.getMapFromString(result.dictionaries);
          if (res.has(text)) {
            end('已在背诵列表中');
            return;
          }
          res.set(text, { dict, time: new Date(), times: 0 });
          chromeCall('storage.local.set', {'dictionaries': JSON.stringify(Array.from(res))})
            .then(() => {
              end('已添加');
            }, fail);
        }, fail);
    },

    /**
     * 删除背诵单词
     * @param {String} text
     */
    removeWord(text, callback) {
      chromeCall('storage.local.get', ['dictionaries'])
        .then((result) => {
          const res = this.getMapFromString(result.dictionaries);
          res.delete(text);
          chromeCall('storage.local.set', {'dictionaries': JSON.stringify(Array.from(res))})
            .then(callback);
        });
    },

    /**
     * 加载复习单词
     */
    loadReview() {
      chromeCall('storage.local.get', ['dictionaries'])
        .then((result) => {
          const res = this.getMapFromString(result.dictionaries);
          const keys = Array.from(res.keys());
          const aval = [];
          keys.forEach((key) => {
            const value = res.get(key);
            // one day later
            if (new Date() - new Date(value.time) > 1000 * 60 * 60 * 24) {
              aval.push(key);
            }
          });
          if (aval.length) {
            const word = aval[Math.floor(Math.random() * aval.length)];
            this.review = word;
            this.reviewDict = res.get(word).dict;
          } else {
            this.review = '';
            this.reviewDict = [];
          }
        }, noop );
    },

    /**
     * 仍然记得当前单词
     */
    rememberWord() {
      this.showdict = false;
      const word = this.review;
      chromeCall('storage.local.get', ['dictionaries'])
        .then((result) => {
          const res = this.getMapFromString(result.dictionaries);
          const value = res.get(word);
          if (++ value.times >= 5) {
            this.removeWord(word, this.loadReview.bind(this));
            return;
          }
          value.time = new Date();
          res.set(word, value);
          chromeCall('storage.local.set', {'dictionaries': JSON.stringify(Array.from(res))})
            .then(this.loadReview.bind(this));
        }, noop );
    },

    /**
     * 遗忘当前单词
     */
    forgotWord() {
      this.showdict = false;
      const word = this.review;
      chromeCall('storage.local.get', ['dictionaries'])
        .then((result) => {
          const res = this.getMapFromString(result.dictionaries);
          const value = res.get(word);
          value.time = new Date();
          res.set(word, value);
          chromeCall('storage.local.set', {'dictionaries': JSON.stringify(Array.from(res))})
            .then(this.loadReview.bind(this));
        }, noop );
    },

    /**
     * 遗忘当前单词
     */
    continueReview() {
      this.showdict = true;
    },

    /**
     * 播放语音
     * @param {String|String[]} textOrTextArray
     * @param {String} [lang] - 文本的语种
     */
    play( textOrTextArray , lang ) {
      if ( Array.isArray( textOrTextArray ) ) {
        textOrTextArray = textOrTextArray.join( '\n' );
      }
      this.$options.client.send( 'play' , {
        text : textOrTextArray ,
        api : this.query.api ,
        from : lang
      } );
    }
  } ,
  mixins : [ widgetMixin ]
} );

