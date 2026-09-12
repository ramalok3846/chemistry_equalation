// ai-parser.js
// 규칙 기반 한국어 자연어 -> 컨트롤 명령 파서 + 대화형(되묻기) 어시스턴트
// 외부 API 불필요, 오프라인 동작. app.js 의 AppState/AppActions 를 호출한다.

const AIParser = (function(){

  // 대화 상태: 이전에 무언가를 되물었다면 여기 저장해서 다음 입력을 그 맥락으로 해석
  let pendingClarification = null; // { type, data }

  const REACTION_ALIASES = {
    "no2_n2o4": ["no2","이산화질소","사산화이질소","n2o4","질소산화물","갈색기체","기본반응식","이산화 질소"],
    "n2_h2_nh3": ["암모니아","하버","nh3","질소","수소","합성암모니아","하버법","하버보슈"],
    "co_h2o_co2_h2": ["수성가스","일산화탄소","co","co2","수소기체","물가스","수성가스전이"]
  };

  const NUM_WORDS = {"하나":1,"한":1,"둘":2,"두":2,"셋":3,"세":3,"넷":4,"네":4,"다섯":5,"열":10,"스물":20};

  function extractNumber(text){
    // "20개", "350K", "350도", "2배", "절반" 등에서 숫자 추출
    let m = text.match(/(-?\d+(\.\d+)?)/);
    if(m) return parseFloat(m[1]);
    for(const w in NUM_WORDS){ if(text.includes(w)) return NUM_WORDS[w]; }
    return null;
  }

  function classifyIntent(raw){
    const text = raw.trim();
    const t = text.toLowerCase();

    // --- 되묻기에 대한 답변 처리 ---
    if(pendingClarification){
      const result = resolveClarification(text);
      if(result) return result;
      // 해석 실패해도 아래에서 새 명령으로 다시 시도
    }

    // --- 온도 ---
    if(/온도|열을|가열|냉각|덥게|춥게|뜨겁게|차갑게|식혀/.test(text)){
      const num = extractNumber(text);
      if(/올려|높여|올리|증가|더 뜨겁|더 덥|가열|덥게/.test(text) && !/낮춰|내려|줄여/.test(text)){
        if(num !== null && /(k|도|켈빈)/i.test(text) === false && num > 0 && num < 30){
          return {type:"temp_delta", delta:num};
        }
        if(num !== null && (/k|도|켈빈/i.test(text))) return {type:"temp_set", value:num};
        return {type:"temp_delta", delta: num || 30};
      }
      if(/낮춰|내려|줄여|감소|더 차갑|더 춥|식혀|냉각/.test(text)){
        if(num !== null && (/k|도|켈빈/i.test(text))) return {type:"temp_set", value:num};
        return {type:"temp_delta", delta: -(num || 30)};
      }
      if(num !== null) return {type:"temp_set", value:num};
      // 온도 언급은 했지만 방향/값이 불분명 -> 되묻기
      pendingClarification = {type:"temp"};
      return {type:"clarify", question:"온도를 어느 정도로 조정할까요? 구체적인 값(예: 350K)이나 '더 낮게' / '더 높게', 혹은 변화폭(예: +50K)으로 말씀해주세요."};
    }

    // --- 부피 ---
    if(/부피|압축|팽창|용기|압력을 (높|낮)/.test(text)){
      if(/절반|반으로|1\/2|반|÷2|나누기\s*2/.test(text)) return {type:"vol_scale", factor:0.5};
      if(/두 ?배|2배|×2|곱하기\s*2/.test(text)) return {type:"vol_scale", factor:2};
      if(/세 ?배|3배/.test(text)) return {type:"vol_scale", factor:3};
      const num = extractNumber(text);
      if(num !== null && /%|퍼센트/.test(text)) return {type:"vol_set_pct", value:num};
      if(num !== null && /배/.test(text)) return {type:"vol_scale", factor:num};
      if(/줄여|압축|감소|작게/.test(text)) return {type:"vol_scale", factor:0.7};
      if(/늘려|팽창|증가|크게/.test(text)) return {type:"vol_scale", factor:1.4};
      if(/초기화|리셋|원래대로/.test(text)) return {type:"vol_reset"};
      pendingClarification = {type:"volume"};
      return {type:"clarify", question:"부피를 어떻게 조정할까요? '절반으로', '2배로', 또는 구체적인 %(예: 150%)로 말씀해주세요."};
    }

    // --- 평형 이동 방향 (르 샤틀리에) ---
    if(/정반응|생성물\s*쪽|오른쪽으로|생성 방향/.test(text)){
      return {type:"shift_forward"};
    }
    if(/역반응|반응물\s*쪽|왼쪽으로|분해 방향/.test(text)){
      return {type:"shift_backward"};
    }

    // --- 반응식 변경 ---
    for(const key in REACTION_ALIASES){
      for(const alias of REACTION_ALIASES[key]){
        if(text.includes(alias)) return {type:"set_reaction", key};
      }
    }
    if(/반응식.*(바꿔|변경|선택)/.test(text) || /다른 반응/.test(text)){
      pendingClarification = {type:"reaction"};
      return {type:"clarify", question:"어떤 반응식으로 바꿀까요? 'NO2 반응', '암모니아 합성(하버법)', '수성가스 반응' 중 골라 말씀해주세요."};
    }

    // --- 입자 수 조정 ---
    let speciesMatch = text.match(/([A-Za-z가-힣0-9₂₃₄]+)\s*(을|를)?\s*(\d+)\s*개?\s*(추가|더해|늘려|증가)/);
    if(speciesMatch){
      return {type:"species_add", name: speciesMatch[1], amount: parseInt(speciesMatch[3])};
    }
    speciesMatch = text.match(/([A-Za-z가-힣0-9₂₃₄]+)\s*(을|를)?\s*(\d+)\s*개?\s*(제거|빼|줄여|감소)/);
    if(speciesMatch){
      return {type:"species_add", name: speciesMatch[1], amount: -parseInt(speciesMatch[3])};
    }
    if(/(추가|더해|늘려)/.test(text) && /개/.test(text)){
      pendingClarification = {type:"species_amount"};
      return {type:"clarify", question:"어떤 물질을 몇 개 추가할까요? 예: 'NO2를 20개 추가해줘'"};
    }

    // --- 시뮬레이션 제어 ---
    if(/멈춰|정지|일시정지|스톱|pause/i.test(text)) return {type:"pause"};
    if(/다시\s*(시작|재생)|계속|재개|플레이|play/i.test(text)) return {type:"play"};
    if(/초기화|리셋|처음부터/.test(text) && /시뮬|전체|다/.test(text)) return {type:"reset_sim"};
    if(/속도.*(빠르게|올려|증가)/.test(text)) return {type:"speed_scale", factor:1.5};
    if(/속도.*(느리게|낮춰|감소)/.test(text)) return {type:"speed_scale", factor:0.6};

    // --- 다운로드/녹화/캡처 ---
    if(/캡처|스크린샷|사진\s*찍/.test(text)) return {type:"screenshot"};
    if(/녹화\s*(시작|해)/.test(text)) return {type:"record_start"};
    if(/녹화\s*(멈춰|정지|종료)/.test(text)) return {type:"record_stop"};
    if(/효과음.*(꺼|off)/i.test(text)) return {type:"sound_off"};
    if(/효과음.*(켜|on)/i.test(text)) return {type:"sound_on"};

    // --- 이해 실패 ---
    return {type:"unknown"};
  }

  function resolveClarification(text){
    const ctx = pendingClarification;
    pendingClarification = null; // 소비
    const num = extractNumber(text);

    if(ctx.type === "temp"){
      if(/낮|내려|춥/.test(text) && num===null) return {type:"temp_delta", delta:-40};
      if(/높|올려|덥|뜨겁/.test(text) && num===null) return {type:"temp_delta", delta:40};
      if(num !== null){
        if(/\+|올려|증가/.test(text)) return {type:"temp_delta", delta:num};
        if(/-|낮춰|감소/.test(text)) return {type:"temp_delta", delta:-Math.abs(num)};
        return {type:"temp_set", value:num};
      }
      return null;
    }
    if(ctx.type === "volume"){
      if(/절반|반/.test(text)) return {type:"vol_scale", factor:0.5};
      if(/두\s*배|2배/.test(text)) return {type:"vol_scale", factor:2};
      if(num !== null){
        if(/%|퍼센트/.test(text)) return {type:"vol_set_pct", value:num};
        return {type:"vol_scale", factor:num};
      }
      return null;
    }
    if(ctx.type === "reaction"){
      for(const key in REACTION_ALIASES){
        for(const alias of REACTION_ALIASES[key]){
          if(text.includes(alias)) return {type:"set_reaction", key};
        }
      }
      if(/no2|이산화질소|첫\s*번째|기본/.test(text)) return {type:"set_reaction", key:"no2_n2o4"};
      if(/암모니아|하버|두\s*번째/.test(text)) return {type:"set_reaction", key:"n2_h2_nh3"};
      if(/수성가스|일산화탄소|세\s*번째/.test(text)) return {type:"set_reaction", key:"co_h2o_co2_h2"};
      return null;
    }
    if(ctx.type === "species_amount"){
      const m = text.match(/([A-Za-z가-힣0-9₂₃₄]+)\D*(\d+)/);
      if(m) return {type:"species_add", name:m[1], amount:parseInt(m[2])};
      return null;
    }
    return null;
  }

  // 결과를 사람이 읽는 응답 문장으로 변환 (app.js 에서 실제 실행 후 호출)
  function describeAction(cmd, execResult){
    switch(cmd.type){
      case "temp_set": return `온도를 <b>${execResult.value}K</b>로 설정했습니다.`;
      case "temp_delta": return `온도를 <b>${execResult.delta>0?'+':''}${execResult.delta}K</b> 만큼 조정하여 <b>${execResult.newValue}K</b>가 되었습니다.`;
      case "vol_scale": return `부피를 <b>${execResult.factor}배</b>로 조정했습니다. (현재 ${execResult.newValue}%)`;
      case "vol_set_pct": return `부피를 <b>${execResult.value}%</b>로 설정했습니다.`;
      case "vol_reset": return `부피를 초기값(100%)으로 되돌렸습니다.`;
      case "shift_forward": return `조건을 조정하여 <b>정반응(생성물 생성) 방향</b>으로 평형을 유도했습니다.`;
      case "shift_backward": return `조건을 조정하여 <b>역반응(반응물 생성) 방향</b>으로 평형을 유도했습니다.`;
      case "set_reaction": return `반응식을 <b>${execResult.label}</b>(으)로 변경했습니다.`;
      case "species_add": return execResult.amount>=0
          ? `<b>${execResult.name}</b> 입자를 <b>${execResult.amount}개</b> 추가했습니다.`
          : `<b>${execResult.name}</b> 입자를 <b>${Math.abs(execResult.amount)}개</b> 제거했습니다.`;
      case "pause": return "시뮬레이션을 일시정지했습니다.";
      case "play": return "시뮬레이션을 재생합니다.";
      case "reset_sim": return "시뮬레이션을 초기화했습니다.";
      case "speed_scale": return `시뮬레이션 속도를 조정했습니다. (현재 ${execResult.newValue}%)`;
      case "screenshot": return "화면을 PNG로 캡처했습니다.";
      case "record_start": return "녹화를 시작합니다.";
      case "record_stop": return "녹화를 종료하고 파일을 저장합니다.";
      case "sound_off": return "효과음을 껐습니다.";
      case "sound_on": return "효과음을 켰습니다.";
      default: return "처리했습니다.";
    }
  }

  function process(text){
    return classifyIntent(text);
  }

  function isAwaitingClarification(){
    return !!pendingClarification;
  }

  return { process, describeAction, isAwaitingClarification };
})();
